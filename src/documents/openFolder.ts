import { Linking } from 'react-native';
import { confirm, notify } from '../components/confirm';
import { getConfig } from '../config/env';
import type { AppServices } from '../services/appServices';
import { poFolderPath } from './paths';

/**
 * Opens a PO's document folder (<library>/<base folder>/<Folder #>) in SharePoint.
 * Folders are created on the first upload, so if it doesn't exist yet the user is asked
 * whether to create it now.
 */
export async function openPoFolder(services: AppServices, folderValue: string): Promise<void> {
  const v = folderValue.trim();
  if (!v) {
    notify('No Folder #', 'This PO has no Folder #, so it has no document folder.');
    return;
  }
  const path = poFolderPath(getConfig().baseFolder, v);
  try {
    const drive = await services.getDrive();
    let item = await drive.getByPath(path);
    if (!item) {
      const create = await confirm(
        `Folder ${v} doesn't exist yet`,
        `There is no "${path}" folder in SharePoint yet (it is created on the first upload). Create it now and open it?`,
        'Create folder',
      );
      if (!create) return;
      await services.uploads.ensureFolder(drive, path);
      item = await drive.getByPath(path);
    }
    if (!item?.webUrl) throw new Error('SharePoint did not return a link for this folder.');
    await Linking.openURL(item.webUrl);
  } catch (e) {
    notify('Could not open the folder', e instanceof Error ? e.message : String(e));
  }
}
