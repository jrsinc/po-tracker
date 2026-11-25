import { AuthRequiredError } from '../auth/types';
import type { OutboxEntry } from '../db/repositories/outbox';
import { normalizeEtag, sameEtag } from '../graph/etag';
import { GraphError, isRetryableError } from '../graph/http';
import type { FieldValues } from '../graph/types';
import { computeBackoffMs } from '../utils/backoff';
import type { SyncContext } from './context';
import { same } from './conflicts';
import { remapTempId } from './tempIds';
import { cleanFields, isTempId, type UpResult } from './types';

/** Key in a delete entry's payload holding the SharePoint id (the local row is already gone). */
export const DELETE_SP_ID = '__spId';

function isVersionMismatch(e: unknown): boolean {
  return e instanceof GraphError && (e.status === 412 || (e.status === 409 && e.code === 'resourceModified'));
}

/**
 * The item's version changed since we read it. If none of the fields this change touches were
 * changed on the server (a flow, another column, or our own earlier save bumped the version),
 * returns the server's current eTag so the change can simply be re-sent. Otherwise null (a real
 * conflict for the user).
 */
async function rebaseIfSafe(ctx: SyncContext, entry: OutboxEntry, spId: string): Promise<string | null> {
  if (entry.op !== 'update' || !entry.base) return null;
  let gi;
  try {
    gi = await ctx.list.getItem(spId);
  } catch {
    return null;
  }
  const server = gi.fields ?? {};
  const untouched = Object.entries(entry.payload).every(([k, mine]) => same(server[k], entry.base![k]) || same(server[k], mine));
  if (!untouched) return null;
  return normalizeEtag(gi.eTag) ?? normalizeEtag(gi.fields?.['@odata.etag']);
}

function errorMessage(e: unknown): string {
  if (e instanceof GraphError) return `${e.status} ${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Fetches the server version and records a conflict for the user to resolve. */
async function recordConflict(ctx: SyncContext, entry: OutboxEntry, spId: string, reason: string): Promise<void> {
  const { store, list } = ctx;
  let serverFields: FieldValues | null = null;
  let serverEtag: string | null = null;
  let serverDeleted = false;
  try {
    const gi = await list.getItem(spId);
    serverFields = cleanFields(gi.fields);
    serverEtag = normalizeEtag(gi.eTag) ?? normalizeEtag(gi.fields?.['@odata.etag']);
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) serverDeleted = true;
    else throw e;
  }
  await store.transaction(async () => {
    await store.outbox.saveConflict({ outboxId: entry.id, serverFields, serverEtag, serverDeleted, fetchedAt: ctx.now() });
    await store.outbox.markConflict(entry.id, reason);
  });
}

/**
 * Sends queued record changes to SharePoint in queue order.
 * - Entries for an item wait behind that item's earlier unresolved entries (order per item).
 * - HTTP 412 / 409 resourceModified (eTag mismatch) or 404 on update/delete -> conflict, resolved by the user.
 * - Network / 429 / 5xx -> retry later with backoff; processing stops (likely offline).
 * - Other 4xx (e.g. validation) -> failed, needs a manual retry.
 */
export async function syncUp(ctx: SyncContext): Promise<UpResult> {
  const { store, list } = ctx;
  const result: UpResult = { sent: 0, conflicts: 0, failed: 0, interrupted: false };
  const ids = (await store.outbox.all()).map((e) => e.id);
  const blocked = new Set<string>();

  for (const id of ids) {
    // Re-read: earlier steps may have remapped the item id or rebased the eTag.
    let entry = await store.outbox.get(id);
    if (!entry) continue;
    const itemLocalId = entry.itemLocalId;
    if (blocked.has(itemLocalId)) continue;
    // Older versions marked eTag mismatches as "failed"; give those another go.
    if (entry.status === 'failed' && /^(409 resourceModified|412 )/.test(entry.lastError ?? '')) {
      await store.outbox.retry(entry.id);
      entry = (await store.outbox.get(id))!;
    }
    if (entry.status === 'conflict' || entry.status === 'failed') {
      blocked.add(itemLocalId);
      if (entry.status === 'conflict') result.conflicts++;
      else result.failed++;
      continue;
    }
    if (entry.nextAttemptAt > ctx.now()) {
      blocked.add(itemLocalId);
      continue;
    }

    try {
      if (entry.op === 'create') {
        const created = await list.createItem(entry.payload);
        const fields = cleanFields(created.fields);
        await store.transaction(async () => {
          const local = await store.items.get(itemLocalId);
          await remapTempId(store, itemLocalId, created.id);
          await store.outbox.remove(entry.id);
          const remaining = await store.outbox.forItem(created.id);
          await store.items.upsert(
            {
              localId: created.id,
              spId: created.id,
              // Keep local values for fields edited after the create was queued.
              fields: remaining.length ? { ...fields, ...(local?.fields ?? {}) } : { ...(local?.fields ?? {}), ...fields },
              etag: normalizeEtag(created.eTag),
              modifiedAt: created.lastModifiedDateTime ?? null,
              modifiedBy: created.lastModifiedBy?.user?.displayName ?? null,
              createdAt: created.createdDateTime ?? null,
              dirty: remaining.length > 0,
            },
            ctx.indexer({ ...fields, ...(local?.fields ?? {}) }),
          );
          // Later updates were queued without an eTag; base them on the new item.
          for (const r of remaining) {
            if (r.op !== 'create' && r.baseEtag === null) await store.outbox.retry(r.id, normalizeEtag(created.eTag));
          }
        });
        result.sent++;
      } else if (entry.op === 'update') {
        const item = await store.items.get(itemLocalId);
        if (!item?.spId || isTempId(itemLocalId)) {
          blocked.add(itemLocalId);
          continue;
        }
        let res: FieldValues;
        try {
          res = await list.updateFields(item.spId, entry.payload, normalizeEtag(entry.baseEtag));
        } catch (e) {
          const rebased = isVersionMismatch(e) ? await rebaseIfSafe(ctx, entry, item.spId) : null;
          if (!rebased) throw e;
          // Only the version moved on; nobody changed these fields. Send again on the new version.
          res = await list.updateFields(item.spId, entry.payload, rebased);
        }
        const newEtag = normalizeEtag(res?.['@odata.etag']);
        await store.transaction(async () => {
          await store.outbox.remove(entry.id);
          const remaining = await store.outbox.forItem(itemLocalId);
          const fields = { ...item.fields, ...cleanFields(res) };
          await store.items.upsert(
            {
              ...item,
              fields: remaining.length ? item.fields : fields,
              etag: newEtag ?? item.etag,
              modifiedAt: typeof res?.Modified === 'string' ? (res.Modified as string) : new Date(ctx.now()).toISOString(),
              dirty: remaining.length > 0,
            },
            ctx.indexer(remaining.length ? item.fields : fields),
          );
          // Chain later queued edits onto the version we just wrote.
          for (const r of remaining) {
            if (r.status === 'pending' && sameEtag(r.baseEtag, entry.baseEtag)) await store.outbox.retry(r.id, newEtag);
          }
        });
        result.sent++;
      } else {
        const spId = String(entry.payload[DELETE_SP_ID] ?? '');
        if (!spId) {
          await store.outbox.remove(entry.id);
          continue;
        }
        try {
          await list.deleteItem(spId, normalizeEtag(entry.baseEtag));
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e; // already gone: fine
        }
        await store.transaction(async () => {
          await store.outbox.removeForItem(itemLocalId);
          await store.items.delete(itemLocalId);
        });
        result.sent++;
      }
    } catch (e) {
      // 412, or 409 resourceModified (what SharePoint returns for list items): changed by someone else.
      const modified = isVersionMismatch(e);
      if (e instanceof GraphError && (modified || (e.status === 404 && entry.op === 'update'))) {
        const spId = entry.op === 'delete' ? String(entry.payload[DELETE_SP_ID]) : (await store.items.get(itemLocalId))?.spId;
        if (spId) {
          await recordConflict(
            ctx,
            entry,
            spId,
            modified ? 'Changed in SharePoint by someone else.' : 'Deleted in SharePoint.',
          );
          result.conflicts++;
          blocked.add(itemLocalId);
          continue;
        }
      }
      if (isRetryableError(e) || e instanceof AuthRequiredError) {
        const retryAfter = e instanceof GraphError ? e.retryAfterMs : undefined;
        await store.outbox.markRetryLater(
          entry.id,
          errorMessage(e),
          ctx.now() + computeBackoffMs(entry.attempts, retryAfter, { random: ctx.random }),
        );
        result.interrupted = true;
        return result;
      }
      await store.outbox.markFailed(entry.id, errorMessage(e), 0);
      result.failed++;
      blocked.add(itemLocalId);
    }
  }
  return result;
}
