import type { FileSource, PickedFile } from './types';

/**
 * Web file storage for the upload queue: the picked File is stored in IndexedDB so a queued
 * upload survives a page reload or going offline. URIs look like "idb://<key>".
 */
const DB_NAME = 'potracker-files';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

const keyOf = (uri: string) => uri.replace(/^idb:\/\//, '');

async function getBlob(uri: string): Promise<Blob> {
  const blob = await tx<Blob | undefined>('readonly', (s) => s.get(keyOf(uri)) as IDBRequest<Blob | undefined>);
  if (!blob) throw new Error('The queued file is no longer stored in this browser.');
  return blob;
}

export const fileSource: FileSource = {
  async importFile(file: PickedFile) {
    const blob = file.blob ?? (await (await fetch(file.uri)).blob());
    const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await tx('readwrite', (s) => s.put(blob, key));
    return { uri: `idb://${key}`, size: blob.size };
  },

  async exists(uri) {
    const n = await tx<number>('readonly', (s) => s.count(keyOf(uri)));
    return n > 0;
  },

  async read(uri, offset, length) {
    const blob = await getBlob(uri);
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  },

  async readAll(uri) {
    return getBlob(uri);
  },

  async remove(uri) {
    await tx('readwrite', (s) => s.delete(keyOf(uri)));
  },
};

export async function clearLocalFiles(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
