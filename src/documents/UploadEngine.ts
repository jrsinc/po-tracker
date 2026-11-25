import { AuthRequiredError } from '../auth/types';
import type { LocalItem } from '../db/repositories/items';
import type { UploadEntry } from '../db/repositories/uploads';
import type { LocalStore } from '../db/store';
import { CHUNK_SIZE, SMALL_UPLOAD_LIMIT, type DriveClient } from '../graph/drive';
import { GraphError, isRetryableError } from '../graph/http';
import type { DriveItem } from '../graph/types';
import { computeBackoffMs } from '../utils/backoff';
import type { FileSource, PickedFile } from './types';
import { buildTargetName, joinPath, parseRangeStart, poFolderPath } from './paths';

export class FolderMissingError extends Error {
  constructor() {
    super('This PO has no Folder # yet. Enter a Folder # before adding documents.');
    this.name = 'FolderMissingError';
  }
}

export interface UploadEngineDeps {
  store: LocalStore;
  /** Resolves the document library client (may throw if the library does not exist). */
  drive: () => Promise<DriveClient>;
  files: FileSource;
  /** Folder inside the library that holds the per-PO folders ('' = root). */
  baseFolder: string;
  /** Reads the PO's FOLDER # value (via the schema; no hard-coded column names). */
  folderValue: (item: LocalItem) => Promise<string | null>;
  now?: () => number;
  random?: () => number;
  onProgress?: (uploadId: number, bytesSent: number, total: number) => void;
}

export interface UploadRunResult {
  uploaded: number;
  failed: number;
  blocked: number;
  interrupted: boolean;
}

class SessionExpiredError extends Error {}

function errorMessage(e: unknown): string {
  if (e instanceof GraphError) return `${e.status} ${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Upload queue for PO documents. Pure TypeScript: storage, network and files are injected.
 * - Files are copied into app storage first, so uploads survive restarts and work offline.
 * - <= 4 MB: single PUT. Larger: upload session in 320 KiB-multiple chunks, resumable.
 * - conflictBehavior=rename everywhere, so existing SharePoint files are never overwritten.
 */
export class UploadEngine {
  private running: Promise<UploadRunResult> | null = null;
  private ensuredFolders = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: UploadEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Target folder for a PO, or null if its FOLDER # is empty. */
  async folderFor(item: LocalItem): Promise<string | null> {
    const v = (await this.deps.folderValue(item))?.trim();
    return v ? poFolderPath(this.deps.baseFolder, v) : null;
  }

  /**
   * Adds a picked file to the upload queue (status "pending"). Throws FolderMissingError if the
   * PO has no FOLDER # value, before copying anything.
   */
  async enqueue(itemLocalId: string, docType: string, file: PickedFile): Promise<number> {
    const { store, files } = this.deps;
    const item = await store.items.get(itemLocalId);
    if (!item) throw new Error('This PO no longer exists on this device.');
    if (!(await this.folderFor(item))) throw new FolderMissingError();

    const imported = await files.importFile(file);
    return store.uploads.add({
      itemLocalId,
      docType,
      originalName: file.name,
      targetName: buildTargetName(docType, file.name),
      localUri: imported.uri,
      size: imported.size,
      mimeType: file.mimeType || 'application/octet-stream',
      status: 'pending',
      now: this.now(),
    });
  }

  /** Processes the queue. Concurrent calls share one run. */
  process(): Promise<UploadRunResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  async retry(uploadId: number): Promise<void> {
    await this.deps.store.uploads.retry(uploadId);
  }

  /** Removes a queued upload and its local copy. */
  async cancel(uploadId: number): Promise<void> {
    const u = await this.deps.store.uploads.get(uploadId);
    if (!u || u.status === 'uploading') return;
    await this.deps.store.uploads.remove(uploadId);
    await this.deps.files.remove(u.localUri).catch(() => undefined);
  }

  private async run(): Promise<UploadRunResult> {
    const { store } = this.deps;
    const result: UploadRunResult = { uploaded: 0, failed: 0, blocked: 0, interrupted: false };
    // An "uploading" row after a crash/kill resumes from its session.
    await store.uploads.resetInterrupted();

    for (const u of await store.uploads.active()) {
      if (u.status === 'failed') {
        result.failed++;
        continue;
      }
      if (u.status === 'pending' && u.nextAttemptAt > this.now()) continue;

      const item = await store.items.get(u.itemLocalId);
      const folder = item ? await this.folderFor(item) : null;
      if (!item || !folder) {
        await store.uploads.setStatus(
          u.id,
          'blocked',
          item ? new FolderMissingError().message : 'The PO for this document was deleted.',
        );
        result.blocked++;
        continue;
      }
      if (u.status === 'blocked') await store.uploads.setStatus(u.id, 'pending');

      try {
        await this.uploadOne(u, folder);
        result.uploaded++;
      } catch (e) {
        if (isRetryableError(e) || e instanceof AuthRequiredError || e instanceof SessionExpiredError) {
          const retryAfter = e instanceof GraphError ? e.retryAfterMs : undefined;
          const wait = e instanceof SessionExpiredError ? 0 : computeBackoffMs(u.attempts, retryAfter, { random: this.deps.random });
          await store.uploads.markRetryLater(u.id, errorMessage(e), this.now() + wait);
          if (!(e instanceof SessionExpiredError)) {
            result.interrupted = true;
            return result;
          }
          continue;
        }
        await store.uploads.markFailed(u.id, errorMessage(e), 0);
        result.failed++;
      }
    }
    return result;
  }

  /** Creates the folder (and parents) if needed. */
  async ensureFolder(drive: DriveClient, folderPath: string): Promise<void> {
    if (this.ensuredFolders.has(folderPath)) return;
    const existing = await drive.getByPath(folderPath);
    if (!existing) {
      const parts = folderPath.split('/');
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/');
        if (i < parts.length - 1 && (await drive.getByPath(joinPath(parent, parts[i]!)))) continue;
        await drive.createFolder(parent, parts[i]!);
      }
    } else if (!existing.folder) {
      throw new Error(`"${folderPath}" exists in the library but is a file, not a folder.`);
    }
    this.ensuredFolders.add(folderPath);
  }

  private async uploadOne(u: UploadEntry, folder: string): Promise<void> {
    const { store, files } = this.deps;
    if (!(await files.exists(u.localUri))) {
      throw new Error('The local copy of this file is missing. Remove it and add the document again.');
    }
    const drive = await this.deps.drive();
    await this.ensureFolder(drive, folder);
    await store.uploads.setStatus(u.id, 'uploading');
    const path = joinPath(folder, u.targetName);

    const item = u.size <= SMALL_UPLOAD_LIMIT ? await this.uploadSmall(drive, u, path) : await this.uploadChunked(drive, u, path);

    await store.uploads.markDone(u.id, item.id, item.name);
    await store.docs.insert({
      folder,
      driveItemId: item.id,
      name: item.name,
      size: item.size ?? u.size,
      webUrl: item.webUrl ?? null,
      mimeType: item.file?.mimeType ?? u.mimeType,
      modifiedAt: item.lastModifiedDateTime ?? new Date(this.now()).toISOString(),
      modifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
      localUri: null,
    });
    await files.remove(u.localUri).catch(() => undefined);
  }

  private async uploadSmall(drive: DriveClient, u: UploadEntry, path: string): Promise<DriveItem> {
    const content = await this.deps.files.readAll(u.localUri);
    const item = await drive.uploadSmall(path, content, u.mimeType);
    this.deps.onProgress?.(u.id, u.size, u.size);
    return item;
  }

  private async uploadChunked(drive: DriveClient, u: UploadEntry, path: string): Promise<DriveItem> {
    const { store, files } = this.deps;
    let url = u.sessionUrl;
    let offset = 0;

    // Resume an existing session if it is still valid.
    if (url && (!u.sessionExpires || Date.parse(u.sessionExpires) > this.now() + 60_000)) {
      try {
        const status = await drive.getUploadSession(url);
        offset = parseRangeStart(status.nextExpectedRanges?.[0]) ?? 0;
      } catch (e) {
        if (!(e instanceof GraphError) || e.isRetryable) throw e;
        url = null; // expired or unknown session: start over
      }
    } else {
      url = null;
    }

    if (!url) {
      const session = await drive.createUploadSession(path);
      url = session.uploadUrl;
      offset = 0;
      await store.uploads.setSession(u.id, url, session.expirationDateTime ?? null);
    }
    await store.uploads.setProgress(u.id, offset);
    this.deps.onProgress?.(u.id, offset, u.size);

    for (;;) {
      const length = Math.min(CHUNK_SIZE, u.size - offset);
      const chunk = await files.read(u.localUri, offset, length);
      let res;
      try {
        res = await drive.uploadChunk(url, chunk, offset, u.size);
      } catch (e) {
        if (e instanceof GraphError && (e.status === 404 || e.status === 410)) {
          await store.uploads.setSession(u.id, null, null);
          throw new SessionExpiredError('Upload session expired; restarting the upload.');
        }
        throw e;
      }
      if (res.done) return res.item;
      offset = parseRangeStart(res.nextExpectedRanges[0]) ?? offset + length;
      await store.uploads.setProgress(u.id, offset);
      this.deps.onProgress?.(u.id, offset, u.size);
    }
  }
}
