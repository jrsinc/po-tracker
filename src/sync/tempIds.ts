import type { LocalStore } from '../db/store';
import { TEMP_PREFIX } from './types';

/** RFC 4122 v4-style id without crypto dependencies (uniqueness only matters on this device). */
export function newTempId(random: () => number = Math.random): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${TEMP_PREFIX}${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

/**
 * After an offline-created item is uploaded, its temporary local id is replaced by the
 * SharePoint id everywhere: the item row, queued record changes and queued documents.
 * Must run inside a transaction.
 */
export async function remapTempId(store: LocalStore, tempId: string, spId: string): Promise<void> {
  await store.items.remapId(tempId, spId, spId);
  await store.outbox.remapItem(tempId, spId);
  await store.uploads.remapItem(tempId, spId);
}
