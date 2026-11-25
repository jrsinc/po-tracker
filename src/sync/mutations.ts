import type { FieldValues } from '../graph/types';
import type { SyncContext } from './context';
import { newTempId } from './tempIds';
import { DELETE_SP_ID } from './upstream';

/**
 * Local record changes. Each change is applied to the SQLite cache immediately (so the UI
 * works offline) and queued in the outbox for the next sync.
 */

export async function createLocalItem(ctx: SyncContext, fields: FieldValues): Promise<string> {
  const { store } = ctx;
  const localId = newTempId(ctx.random);
  const nowIso = new Date(ctx.now()).toISOString();
  await store.transaction(async () => {
    await store.items.upsert(
      {
        localId,
        spId: null,
        fields,
        etag: null,
        modifiedAt: nowIso,
        modifiedBy: null,
        createdAt: nowIso,
        dirty: true,
      },
      ctx.indexer(fields),
    );
    await store.outbox.add({ itemLocalId: localId, op: 'create', payload: fields, baseEtag: null, now: ctx.now() });
  });
  return localId;
}

/**
 * Queues a field update. If the item's last queued entry is a still-pending create/update,
 * the change is merged into it (keeping its original base eTag) instead of adding a new entry.
 */
export async function updateLocalItem(ctx: SyncContext, localId: string, patch: FieldValues): Promise<void> {
  const { store } = ctx;
  if (Object.keys(patch).length === 0) return;
  await store.transaction(async () => {
    const item = await store.items.get(localId);
    if (!item) throw new Error('This PO no longer exists on this device.');
    // What these fields were before this edit (null when never read from SharePoint).
    const before: FieldValues = {};
    for (const k of Object.keys(patch)) before[k] = item.fields[k] ?? null;
    const fields = { ...item.fields, ...patch };
    await store.items.upsert({ ...item, fields, dirty: true, modifiedAt: new Date(ctx.now()).toISOString() }, ctx.indexer(fields));

    const queued = await store.outbox.forItem(localId);
    const last = queued[queued.length - 1];
    if (last && last.status === 'pending' && last.attempts === 0 && (last.op === 'create' || last.op === 'update')) {
      // Keep the earliest "before" value for each field.
      const base = last.op === 'update' ? { ...before, ...(last.base ?? {}) } : undefined;
      await store.outbox.setPayload(last.id, { ...last.payload, ...patch }, base);
    } else {
      await store.outbox.add({ itemLocalId: localId, op: 'update', payload: patch, baseEtag: item.etag, base: before, now: ctx.now() });
    }
  });
}

/**
 * Deletes locally and queues a delete. An item that was never uploaded is simply dropped
 * together with its queued changes. Returns the ids of queued uploads that were cancelled.
 */
export async function deleteLocalItem(ctx: SyncContext, localId: string): Promise<number[]> {
  const { store } = ctx;
  const cancelledUploads: number[] = [];
  await store.transaction(async () => {
    const item = await store.items.get(localId);
    if (!item) return;
    const queued = await store.outbox.forItem(localId);
    await store.outbox.removeForItem(localId);
    if (item.spId) {
      // Keep the version the user saw as the delete precondition.
      const firstUpdate = queued.find((q) => q.op === 'update');
      await store.outbox.add({
        itemLocalId: localId,
        op: 'delete',
        payload: { [DELETE_SP_ID]: item.spId },
        baseEtag: firstUpdate?.baseEtag ?? item.etag,
        now: ctx.now(),
      });
    }
    for (const u of await store.uploads.forItem(localId)) {
      if (u.status !== 'done') {
        cancelledUploads.push(u.id);
        await store.uploads.remove(u.id);
      }
    }
    await store.items.delete(localId);
  });
  return cancelledUploads;
}
