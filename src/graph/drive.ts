import { encodeDrivePath, GraphError, type GraphHttp, type RawBody } from './http';
import type { DriveItem, Paged, UploadSession } from './types';

export const SMALL_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload-session chunks must be multiples of 320 KiB. 10 x 320 KiB = 3.125 MiB. */
export const CHUNK_SIZE = 320 * 1024 * 10;

export type ChunkResult =
  | { done: true; item: DriveItem }
  | { done: false; nextExpectedRanges: string[] };

/** Operations the upload engine needs from the library. Implemented by DriveApi; faked in tests. */
export interface DriveClient {
  getByPath(path: string): Promise<DriveItem | null>;
  createFolder(parentPath: string, name: string): Promise<void>;
  listChildren(path: string): Promise<DriveItem[]>;
  uploadSmall(path: string, content: RawBody, mimeType: string): Promise<DriveItem>;
  createUploadSession(path: string): Promise<UploadSession>;
  getUploadSession(uploadUrl: string): Promise<UploadSession>;
  uploadChunk(uploadUrl: string, chunk: Uint8Array, start: number, total: number): Promise<ChunkResult>;
  getItem(itemId: string): Promise<DriveItem>;
}

/** Typed wrapper around the document library (drive) endpoints. */
export class DriveApi implements DriveClient {
  constructor(private readonly http: GraphHttp, public readonly driveId: string) {}

  private pathUrl(path: string, suffix = ''): string {
    const enc = encodeDrivePath(path);
    return enc ? `/drives/${this.driveId}/root:/${enc}:${suffix}` : `/drives/${this.driveId}/root${suffix}`;
  }

  /** Returns the item at path, or null if it does not exist. */
  async getByPath(path: string): Promise<DriveItem | null> {
    try {
      return await this.http.request<DriveItem>(this.pathUrl(path));
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) return null;
      throw e;
    }
  }

  /** Creates a folder; succeeds quietly if it already exists. */
  async createFolder(parentPath: string, name: string): Promise<void> {
    const url = encodeDrivePath(parentPath)
      ? this.pathUrl(parentPath, '/children')
      : `/drives/${this.driveId}/root/children`;
    try {
      await this.http.request<DriveItem>(url, {
        method: 'POST',
        body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      });
    } catch (e) {
      if (e instanceof GraphError && (e.status === 409 || e.code === 'nameAlreadyExists')) return;
      throw e;
    }
  }

  async listChildren(path: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let next: string | undefined = this.pathUrl(
      path,
      '/children?$top=200&$select=id,name,size,webUrl,lastModifiedDateTime,lastModifiedBy,file,folder',
    );
    while (next) {
      const page: Paged<DriveItem> = await this.http.request<Paged<DriveItem>>(next);
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  /** Simple upload for files up to 4 MB. Never overwrites (conflictBehavior=rename). */
  uploadSmall(path: string, content: RawBody, mimeType: string): Promise<DriveItem> {
    return this.http.request<DriveItem>(
      this.pathUrl(path, '/content?@microsoft.graph.conflictBehavior=rename'),
      {
        method: 'PUT',
        rawBody: content,
        headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      },
    );
  }

  createUploadSession(path: string): Promise<UploadSession> {
    return this.http.request<UploadSession>(this.pathUrl(path, '/createUploadSession'), {
      method: 'POST',
      body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
    });
  }

  /** Status of an existing session (used to resume). The URL is pre-authenticated. */
  getUploadSession(uploadUrl: string): Promise<UploadSession> {
    return this.http.request<UploadSession>(uploadUrl, { auth: false });
  }

  /** Uploads bytes [start, start + chunk.length) of a file of `total` bytes. */
  async uploadChunk(uploadUrl: string, chunk: Uint8Array, start: number, total: number): Promise<ChunkResult> {
    const end = start + chunk.length - 1;
    const res = await this.http.send(uploadUrl, {
      method: 'PUT',
      auth: false,
      rawBody: chunk,
      headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as DriveItem & UploadSession) : undefined;
    if (res.status === 200 || res.status === 201) return { done: true, item: json as DriveItem };
    return { done: false, nextExpectedRanges: json?.nextExpectedRanges ?? [] };
  }

  /** Fresh metadata, including a short-lived pre-authenticated download URL. */
  getItem(itemId: string): Promise<DriveItem> {
    return this.http.request<DriveItem>(`/drives/${this.driveId}/items/${itemId}`);
  }
}
