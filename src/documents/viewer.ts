import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { CachedDoc } from '../db/repositories/misc';
import type { DriveClient } from '../graph/drive';
import { sanitizeName } from './paths';

/**
 * Native: downloads a document on demand into the cache and opens the system preview
 * (Quick Look on iOS, a viewer app on Android), falling back to the share sheet.
 * Returns the local URI so the listing can remember it for offline viewing.
 */
export async function openDocument(drive: DriveClient, doc: CachedDoc): Promise<string | null> {
  let file = doc.localUri ? new File(doc.localUri) : null;
  if (!file?.exists) {
    const meta = await drive.getItem(doc.driveItemId);
    const url = meta['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('SharePoint did not return a download link for this file.');
    const dir = new Directory(Paths.cache, 'documents', sanitizeName(doc.folder.replace(/\//g, '_'), 'folder'));
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
    file = await File.downloadFileAsync(url, new File(dir, sanitizeName(doc.name)), { idempotent: true });
  }
  try {
    await file.preview({ title: doc.name, mimeType: doc.mimeType ?? undefined });
  } catch {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { dialogTitle: doc.name, mimeType: doc.mimeType ?? undefined });
    } else {
      throw new Error('No app on this device can open this file type.');
    }
  }
  return file.uri;
}

export function hasLocalCopy(doc: CachedDoc): boolean {
  return !!doc.localUri && new File(doc.localUri).exists;
}
