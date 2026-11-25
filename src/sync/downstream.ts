import { SYNC_KEYS } from '../db/store';
import { normalizeEtag, sameEtag } from '../graph/etag';
import { GraphError } from '../graph/http';
import type { GraphListItem, Paged } from '../graph/types';
import type { SyncContext } from './context';
import { cleanFields, DeltaExpiredError, type ChangeEvent, type DownResult } from './types';

function etagOf(gi: GraphListItem): string | null {
  return normalizeEtag(gi.eTag) ?? normalizeEtag(gi.fields?.['@odata.etag']);
}

function isRemoved(gi: GraphListItem): boolean {
  return !!gi['@removed'] || !!gi.deleted;
}

function isDeltaExpired(e: unknown): boolean {
  if (!(e instanceof GraphError)) return false;
  return (
    e.status === 410 ||
    ['resyncRequired', 'syncStateNotFound', 'syncStateInvalid', 'invalidDeltaToken'].includes(e.code)
  );
}

/**
 * Applies one server item to the local cache.
 * Items with queued local changes keep their local fields and old eTag, so the queued PATCH
 * is still checked against the version it was based on (a server change then shows up as a
 * 412 conflict instead of being overwritten silently).
 */
async function applyServerItem(ctx: SyncContext, gi: GraphListItem, track: boolean): Promise<ChangeEvent | null> {
  const { store } = ctx;
  const existing = await store.items.getBySpId(gi.id);
  const fields = cleanFields(gi.fields);
  const etag = etagOf(gi);
  const modifiedBy = gi.lastModifiedBy?.user?.displayName ?? null;

  if (existing?.dirty) {
    return track && !sameEtag(existing.etag, etag)
      ? { kind: 'updated', localId: existing.localId, spId: gi.id, before: existing.fields, after: fields, modifiedBy }
      : null;
  }

  await store.items.upsert(
    {
      localId: existing?.localId ?? gi.id,
      spId: gi.id,
      fields,
      etag,
      modifiedAt: gi.lastModifiedDateTime ?? null,
      modifiedBy,
      createdAt: gi.createdDateTime ?? existing?.createdAt ?? null,
      dirty: false,
    },
    ctx.indexer(fields),
  );

  if (!track) return null;
  if (!existing) return { kind: 'created', localId: gi.id, spId: gi.id, before: null, after: fields, modifiedBy };
  if (sameEtag(existing.etag, etag)) return null;
  return { kind: 'updated', localId: existing.localId, spId: gi.id, before: existing.fields, after: fields, modifiedBy };
}

/**
 * The PO was deleted in SharePoint. If it has unsynced local edits it is kept: the queued
 * update then fails with 404 and becomes a conflict the user resolves (re-create or accept
 * the deletion). Nothing is discarded silently.
 */
async function applyServerDelete(ctx: SyncContext, spId: string, kept: string[]): Promise<ChangeEvent | null> {
  const { store } = ctx;
  const existing = await store.items.getBySpId(spId);
  if (!existing) return null;
  if (existing.dirty) {
    kept.push(existing.localId);
    await store.log.add('warn', `PO ${spId} was deleted in SharePoint but has unsynced changes here; resolve it on the Sync screen.`, ctx.now());
    return { kind: 'deleted', localId: existing.localId, spId, before: existing.fields, after: null, modifiedBy: null };
  }
  await store.items.delete(existing.localId);
  return { kind: 'deleted', localId: existing.localId, spId, before: existing.fields, after: null, modifiedBy: null };
}

/** Items missing fields in a delta page are fetched individually. */
async function withFields(ctx: SyncContext, gi: GraphListItem): Promise<GraphListItem> {
  if (gi.fields || isRemoved(gi)) return gi;
  try {
    return await ctx.list.getItem(gi.id);
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return { ...gi, deleted: { state: 'deleted' } };
    throw e;
  }
}

/** Full paged load. Also establishes a delta link for later incremental syncs. */
export async function fullLoad(ctx: SyncContext): Promise<DownResult> {
  const { store, list } = ctx;
  const discarded: string[] = [];

  // Take the delta position BEFORE loading, so changes made during the load are not missed.
  let deltaLink: string | null = null;
  try {
    const latest = await list.getPage(list.deltaLatestUrl());
    deltaLink = latest['@odata.deltaLink'] ?? null;
  } catch (e) {
    if (!(e instanceof GraphError) || e.isRetryable || e.status === 401) throw e;
    // token=latest not supported: fall back to enumerating delta after the load.
  }

  const seen = new Set<string>();
  let url: string | undefined = list.firstItemsUrl();
  while (url) {
    const page: Paged<GraphListItem> = await list.getPage(url);
    await store.transaction(async () => {
      for (const gi of page.value) {
        seen.add(gi.id);
        await applyServerItem(ctx, gi, false);
      }
    });
    url = page['@odata.nextLink'];
  }

  // Anything cached locally that is no longer on the server was deleted there.
  const local = await store.items.allSpIds();
  await store.transaction(async () => {
    for (const l of local) {
      if (!seen.has(l.spId)) await applyServerDelete(ctx, l.spId, discarded);
    }
  });

  if (!deltaLink) {
    let next: string | undefined = list.deltaStartUrl();
    while (next) {
      const page: Paged<GraphListItem> = await list.getPage(next);
      if (page['@odata.deltaLink']) deltaLink = page['@odata.deltaLink'];
      next = page['@odata.nextLink'];
    }
  }

  const now = new Date(ctx.now()).toISOString();
  await store.syncState.set(SYNC_KEYS.deltaLink, deltaLink);
  await store.syncState.set(SYNC_KEYS.lastFullSync, now);
  return { mode: 'full', changes: [], discarded };
}

/** Incremental sync from the stored delta link. Throws DeltaExpiredError if it has expired. */
export async function deltaSync(ctx: SyncContext, deltaLink: string): Promise<DownResult> {
  const { store, list } = ctx;
  const changes: ChangeEvent[] = [];
  const discarded: string[] = [];
  let url: string | undefined = deltaLink;
  let nextDelta: string | null = null;

  while (url) {
    let page: Paged<GraphListItem>;
    try {
      page = await list.getPage(url);
    } catch (e) {
      if (isDeltaExpired(e)) throw new DeltaExpiredError();
      throw e;
    }
    const items: GraphListItem[] = [];
    for (const gi of page.value) items.push(await withFields(ctx, gi));
    await store.transaction(async () => {
      for (const gi of items) {
        const ev = isRemoved(gi)
          ? await applyServerDelete(ctx, gi.id, discarded)
          : await applyServerItem(ctx, gi, true);
        if (ev) changes.push(ev);
      }
    });
    if (page['@odata.deltaLink']) nextDelta = page['@odata.deltaLink'];
    url = page['@odata.nextLink'];
  }

  if (nextDelta) await store.syncState.set(SYNC_KEYS.deltaLink, nextDelta);
  return { mode: 'delta', changes, discarded };
}

/** Downstream sync: delta if possible, full load on first run or when the delta token expired. */
export async function syncDown(ctx: SyncContext): Promise<DownResult> {
  const deltaLink = await ctx.store.syncState.get(SYNC_KEYS.deltaLink);
  if (!deltaLink) return fullLoad(ctx);
  try {
    return await deltaSync(ctx, deltaLink);
  } catch (e) {
    if (e instanceof DeltaExpiredError) {
      await ctx.store.log.add('info', 'Sync token expired; reloading all POs.', ctx.now());
      await ctx.store.syncState.set(SYNC_KEYS.deltaLink, null);
      return fullLoad(ctx);
    }
    throw e;
  }
}
