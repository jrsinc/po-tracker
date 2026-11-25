import type { LocalItem } from '../db/repositories/items';
import type { ConflictRecord, OutboxEntry } from '../db/repositories/outbox';
import type { FieldValues } from '../graph/types';
import type { SyncContext } from './context';
import { DELETE_SP_ID } from './upstream';

export interface FieldConflict {
  /** Graph field key */
  key: string;
  mine: unknown;
  server: unknown;
}

export interface ConflictView {
  entry: OutboxEntry;
  conflict: ConflictRecord;
  item: LocalItem | null;
  /** Fields this change touches, with both versions (only ones that differ). */
  fields: FieldConflict[];
}

export function same(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined || v === '' ? null : v);
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
}

/** Field-by-field comparison between the queued change and the server version. */
export async function getConflictView(ctx: SyncContext, outboxId: number): Promise<ConflictView | null> {
  const entry = await ctx.store.outbox.get(outboxId);
  const conflict = await ctx.store.outbox.getConflict(outboxId);
  if (!entry || !conflict) return null;
  const item = await ctx.store.items.get(entry.itemLocalId);
  const server = conflict.serverFields ?? {};
  const fields: FieldConflict[] =
    entry.op === 'update'
      ? Object.entries(entry.payload)
          .filter(([k, v]) => conflict.serverDeleted || !same(v, server[k]))
          .map(([key, mine]) => ({ key, mine, server: conflict.serverDeleted ? null : server[key] }))
      : [];
  return { entry, conflict, item, fields };
}

export type Resolution =
  | { mode: 'mine' }
  | { mode: 'server' }
  /** Keep my value for these Graph keys, take the server's for the rest. */
  | { mode: 'merge'; keepMine: string[] };

/**
 * Applies the user's decision. Nothing is overwritten without this explicit choice.
 * `writableKeys` lists the Graph keys the app may write (needed to re-create a deleted PO).
 */
export async function resolveConflict(
  ctx: SyncContext,
  outboxId: number,
  resolution: Resolution,
  writableKeys: string[],
): Promise<void> {
  const { store } = ctx;
  const view = await getConflictView(ctx, outboxId);
  if (!view) return;
  const { entry, conflict, item } = view;
  const serverFields = conflict.serverFields ?? {};

  await store.transaction(async () => {
    if (entry.op === 'delete') {
      if (resolution.mode === 'server') {
        // Undo the delete: bring the server version back.
        await store.outbox.remove(entry.id);
        if (!conflict.serverDeleted) {
          const spId = String(entry.payload[DELETE_SP_ID]);
          await store.items.upsert(
            {
              localId: spId,
              spId,
              fields: serverFields,
              etag: conflict.serverEtag,
              modifiedAt: typeof serverFields.Modified === 'string' ? serverFields.Modified : null,
              modifiedBy: null,
              createdAt: null,
              dirty: false,
            },
            ctx.indexer(serverFields),
          );
        }
      } else if (conflict.serverDeleted) {
        await store.outbox.remove(entry.id);
      } else {
        await store.outbox.retry(entry.id, conflict.serverEtag);
        await store.db.run('DELETE FROM conflicts WHERE outbox_id = ?', [entry.id]);
      }
      return;
    }

    if (!item) {
      await store.outbox.remove(entry.id);
      return;
    }

    const keep = resolution.mode === 'mine' ? Object.keys(entry.payload) : resolution.mode === 'merge' ? resolution.keepMine : [];
    const minePayload: FieldValues = {};
    for (const k of keep) if (k in entry.payload) minePayload[k] = entry.payload[k];

    const others = (await store.outbox.forItem(item.localId)).filter((e) => e.id !== entry.id);

    if (conflict.serverDeleted) {
      await store.outbox.remove(entry.id);
      if (keep.length === 0) {
        // Accept the deletion.
        await store.outbox.removeForItem(item.localId);
        await store.items.delete(item.localId);
        return;
      }
      // Re-create the PO from the local copy.
      const payload: FieldValues = {};
      for (const k of writableKeys) if (item.fields[k] !== undefined && item.fields[k] !== null) payload[k] = item.fields[k];
      await store.outbox.removeForItem(item.localId);
      // The local id stays the old SharePoint id until the create returns the new one.
      await store.items.upsert({ ...item, spId: null, etag: null, dirty: true }, ctx.indexer(item.fields));
      await store.outbox.add({ itemLocalId: item.localId, op: 'create', payload, baseEtag: null, now: ctx.now() });
      return;
    }

    const fields = { ...item.fields, ...serverFields, ...minePayload };
    if (Object.keys(minePayload).length === 0) {
      await store.outbox.remove(entry.id);
    } else {
      await store.outbox.setPayload(entry.id, minePayload);
      await store.outbox.retry(entry.id, conflict.serverEtag);
      await store.db.run('DELETE FROM conflicts WHERE outbox_id = ?', [entry.id]);
    }
    // Later queued edits are now based on the server version too.
    for (const o of others) if (o.status !== 'conflict') await store.outbox.retry(o.id, conflict.serverEtag);
    const stillDirty = Object.keys(minePayload).length > 0 || others.length > 0;
    await store.items.upsert({ ...item, fields, etag: conflict.serverEtag, dirty: stillDirty }, ctx.indexer(fields));
  });
}
