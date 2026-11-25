// Test-only fakes for the document library and on-device file storage.
import type { FileSource, PickedFile } from '../documents/types';
import type { ChunkResult, DriveClient } from '../graph/drive';
import { GraphError } from '../graph/http';
import type { RawBody } from '../graph/http';
import type { DriveItem, UploadSession } from '../graph/types';

interface Session {
  path: string;
  total: number;
  received: number;
  parts: Uint8Array[];
  expired: boolean;
}

export class FakeDrive implements DriveClient {
  folders = new Set<string>(['']);
  files = new Map<string, Uint8Array>();
  sessions = new Map<string, Session>();
  calls: string[] = [];
  private nextId = 1;
  private nextSession = 1;
  failures: { op: string; error: Error; afterChunks?: number }[] = [];
  chunkCount = 0;

  private fail(op: string) {
    const i = this.failures.findIndex((f) => f.op === op && (f.afterChunks === undefined || this.chunkCount >= f.afterChunks));
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      throw f!.error;
    }
  }

  private uniqueName(path: string): string {
    if (!this.files.has(path)) return path;
    const dot = path.lastIndexOf('.');
    const [base, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    for (let i = 1; ; i++) {
      const candidate = `${base} ${i}${ext}`;
      if (!this.files.has(candidate)) return candidate;
    }
  }

  private store(path: string, data: Uint8Array): DriveItem {
    const parent = path.split('/').slice(0, -1).join('/');
    if (!this.folders.has(parent)) throw new GraphError(404, 'itemNotFound', `Parent ${parent} missing`);
    const finalPath = this.uniqueName(path); // conflictBehavior=rename
    this.files.set(finalPath, data);
    return { id: `f${this.nextId++}`, name: finalPath.split('/').pop()!, size: data.length, file: { mimeType: 'application/pdf' } };
  }

  async getByPath(path: string): Promise<DriveItem | null> {
    this.calls.push(`GET ${path}`);
    if (this.folders.has(path)) return { id: `d:${path}`, name: path.split('/').pop()!, folder: { childCount: 0 } };
    if (this.files.has(path)) return { id: `f:${path}`, name: path.split('/').pop()!, file: {} };
    return null;
  }

  async createFolder(parentPath: string, name: string): Promise<void> {
    this.calls.push(`MKDIR ${parentPath}|${name}`);
    this.fail('createFolder');
    if (!this.folders.has(parentPath)) throw new GraphError(404, 'itemNotFound', 'parent missing');
    this.folders.add(parentPath ? `${parentPath}/${name}` : name);
  }

  async listChildren(path: string): Promise<DriveItem[]> {
    return [...this.files.keys()]
      .filter((p) => p.split('/').slice(0, -1).join('/') === path)
      .map((p, i) => ({ id: `c${i}`, name: p.split('/').pop()!, size: this.files.get(p)!.length }));
  }

  async uploadSmall(path: string, content: RawBody): Promise<DriveItem> {
    this.calls.push(`PUT ${path}`);
    this.fail('uploadSmall');
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);
    return this.store(path, bytes);
  }

  async createUploadSession(path: string): Promise<UploadSession> {
    this.calls.push(`SESSION ${path}`);
    this.fail('createUploadSession');
    const url = `https://upload/${this.nextSession++}`;
    this.sessions.set(url, { path, total: 0, received: 0, parts: [], expired: false });
    return { uploadUrl: url, expirationDateTime: '2099-01-01T00:00:00Z' };
  }

  async getUploadSession(uploadUrl: string): Promise<UploadSession> {
    this.calls.push(`STATUS ${uploadUrl}`);
    const s = this.sessions.get(uploadUrl);
    if (!s || s.expired) throw new GraphError(404, 'itemNotFound', 'session gone');
    return { uploadUrl, nextExpectedRanges: [`${s.received}-`] };
  }

  async uploadChunk(uploadUrl: string, chunk: Uint8Array, start: number, total: number): Promise<ChunkResult> {
    this.calls.push(`CHUNK ${uploadUrl} ${start}+${chunk.length}/${total}`);
    this.fail('uploadChunk');
    const s = this.sessions.get(uploadUrl);
    if (!s || s.expired) throw new GraphError(404, 'itemNotFound', 'session gone');
    if (start !== s.received) throw new GraphError(416, 'invalidRange', `expected ${s.received}`);
    if (chunk.length % (320 * 1024) !== 0 && start + chunk.length !== total) {
      throw new GraphError(400, 'invalidChunk', 'chunk not a multiple of 320 KiB');
    }
    this.chunkCount++;
    s.total = total;
    s.parts.push(chunk);
    s.received += chunk.length;
    if (s.received === total) {
      const all = new Uint8Array(total);
      let o = 0;
      for (const p of s.parts) {
        all.set(p, o);
        o += p.length;
      }
      this.sessions.delete(uploadUrl);
      return { done: true, item: this.store(s.path, all) };
    }
    return { done: false, nextExpectedRanges: [`${s.received}-`] };
  }

  async getItem(itemId: string): Promise<DriveItem> {
    return { id: itemId, name: itemId };
  }
}

export class FakeFiles implements FileSource {
  files = new Map<string, Uint8Array>();
  private n = 0;

  async importFile(file: PickedFile) {
    const data = new Uint8Array(file.size ?? 10).map((_, i) => i % 251);
    const uri = `file:///queue/${++this.n}_${file.name}`;
    this.files.set(uri, data);
    return { uri, size: data.length };
  }

  async exists(uri: string) {
    return this.files.has(uri);
  }

  async read(uri: string, offset: number, length: number) {
    return this.files.get(uri)!.slice(offset, offset + length);
  }

  async readAll(uri: string) {
    return this.files.get(uri)!;
  }

  async remove(uri: string) {
    this.files.delete(uri);
  }
}
