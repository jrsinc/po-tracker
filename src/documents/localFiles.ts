import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { FileSource, PickedFile } from './types';
import { sanitizeName } from './paths';

/** Native (iOS/Android) file storage for the upload queue, in the app's document directory. */
function queueDir(): Directory {
  const dir = new Directory(Paths.document, 'upload-queue');
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

let counter = 0;

export const fileSource: FileSource = {
  async importFile(file: PickedFile) {
    const src = new File(file.uri);
    const dest = new File(queueDir(), `${Date.now()}_${++counter}_${sanitizeName(file.name)}`);
    await src.copy(dest);
    return { uri: dest.uri, size: dest.size };
  },

  async exists(uri) {
    return new File(uri).exists;
  },

  async read(uri, offset, length) {
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      handle.offset = offset;
      return await handle.readBytes(length);
    } finally {
      handle.close();
    }
  },

  async readAll(uri) {
    return new File(uri).bytes();
  },

  async remove(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
};

/** Removes every queued file (used on sign-out). */
export async function clearLocalFiles(): Promise<void> {
  for (const name of ['upload-queue', 'documents']) {
    const dir = new Directory(Paths.document, name);
    if (dir.exists) dir.delete();
  }
  const cache = new Directory(Paths.cache, 'documents');
  if (cache.exists) cache.delete();
}
