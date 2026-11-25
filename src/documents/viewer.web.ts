import type { CachedDoc } from '../db/repositories/misc';
import type { DriveClient } from '../graph/drive';

/** Web: opens the file in SharePoint's own viewer in a new tab (uses the browser's M365 session). */
export async function openDocument(drive: DriveClient, doc: CachedDoc): Promise<string | null> {
  let url = doc.webUrl;
  if (!url) url = (await drive.getItem(doc.driveItemId)).webUrl ?? null;
  if (!url) throw new Error('SharePoint did not return a link for this file.');
  window.open(url, '_blank', 'noopener');
  return null;
}

export function hasLocalCopy(): boolean {
  return false;
}
