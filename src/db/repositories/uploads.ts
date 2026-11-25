import type { SqlDriver } from '../SqlDriver';

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'failed' | 'blocked';

export interface UploadEntry {
  id: number;
  itemLocalId: string;
  docType: string;
  originalName: string;
  /** Sanitised file name with the document-type prefix. */
  targetName: string;
  /** App-owned copy of the file (file:// on native, idb:// on web). */
  localUri: string;
  size: number;
  mimeType: string;
  status: UploadStatus;
  sessionUrl: string | null;
  sessionExpires: string | null;
  bytesSent: number;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  remoteItemId: string | null;
  remoteName: string | null;
  createdAt: number;
}

interface Row {
  id: number;
  item_local_id: string;
  doc_type: string;
  original_name: string;
  target_name: string;
  local_uri: string;
  size: number;
  mime_type: string;
  status: UploadStatus;
  session_url: string | null;
  session_expires: string | null;
  bytes_sent: number;
  attempts: number;
  last_error: string | null;
  next_attempt_at: number;
  remote_item_id: string | null;
  remote_name: string | null;
  created_at: number;
}

function fromRow(r: Row): UploadEntry {
  return {
    id: r.id,
    itemLocalId: r.item_local_id,
    docType: r.doc_type,
    originalName: r.original_name,
    targetName: r.target_name,
    localUri: r.local_uri,
    size: r.size,
    mimeType: r.mime_type,
    status: r.status,
    sessionUrl: r.session_url,
    sessionExpires: r.session_expires,
    bytesSent: r.bytes_sent,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    remoteItemId: r.remote_item_id,
    remoteName: r.remote_name,
    createdAt: r.created_at,
  };
}

export class UploadsRepo {
  constructor(private readonly db: SqlDriver) {}

  async add(u: {
    itemLocalId: string;
    docType: string;
    originalName: string;
    targetName: string;
    localUri: string;
    size: number;
    mimeType: string;
    status: UploadStatus;
    lastError?: string | null;
    now: number;
  }): Promise<number> {
    const r = await this.db.run(
      `INSERT INTO uploads (item_local_id, doc_type, original_name, target_name, local_uri, size, mime_type, status, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.itemLocalId, u.docType, u.originalName, u.targetName, u.localUri, u.size, u.mimeType, u.status, u.lastError ?? null, u.now],
    );
    return r.lastInsertRowId;
  }

  async get(id: number): Promise<UploadEntry | null> {
    const r = await this.db.get<Row>('SELECT * FROM uploads WHERE id = ?', [id]);
    return r ? fromRow(r) : null;
  }

  async all(): Promise<UploadEntry[]> {
    return (await this.db.all<Row>('SELECT * FROM uploads ORDER BY id')).map(fromRow);
  }

  async forItem(itemLocalId: string): Promise<UploadEntry[]> {
    return (await this.db.all<Row>('SELECT * FROM uploads WHERE item_local_id = ? ORDER BY id', [itemLocalId])).map(fromRow);
  }

  /** Queue entries that still need work (not done). */
  async active(): Promise<UploadEntry[]> {
    return (await this.db.all<Row>("SELECT * FROM uploads WHERE status != 'done' ORDER BY id")).map(fromRow);
  }

  async setStatus(id: number, status: UploadStatus, lastError: string | null = null): Promise<void> {
    await this.db.run('UPDATE uploads SET status = ?, last_error = ? WHERE id = ?', [status, lastError, id]);
  }

  async markFailed(id: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.db.run(
      "UPDATE uploads SET status = 'failed', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
      [error, nextAttemptAt, id],
    );
  }

  async markRetryLater(id: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.db.run(
      "UPDATE uploads SET status = 'pending', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
      [error, nextAttemptAt, id],
    );
  }

  async setSession(id: number, url: string | null, expires: string | null): Promise<void> {
    await this.db.run('UPDATE uploads SET session_url = ?, session_expires = ? WHERE id = ?', [url, expires, id]);
  }

  async setProgress(id: number, bytesSent: number): Promise<void> {
    await this.db.run('UPDATE uploads SET bytes_sent = ? WHERE id = ?', [bytesSent, id]);
  }

  async markDone(id: number, remoteItemId: string, remoteName: string): Promise<void> {
    await this.db.run(
      `UPDATE uploads SET status = 'done', remote_item_id = ?, remote_name = ?, bytes_sent = size,
       session_url = NULL, last_error = NULL WHERE id = ?`,
      [remoteItemId, remoteName, id],
    );
  }

  async retry(id: number): Promise<void> {
    await this.db.run(
      "UPDATE uploads SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = 0 WHERE id = ? AND status != 'done'",
      [id],
    );
  }

  async retryAllFailed(): Promise<void> {
    await this.db.run(
      "UPDATE uploads SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status IN ('failed','blocked')",
    );
    await this.db.run("UPDATE uploads SET next_attempt_at = 0 WHERE status = 'pending'");
  }

  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM uploads WHERE id = ?', [id]);
  }

  async remapItem(oldLocalId: string, newLocalId: string): Promise<void> {
    await this.db.run('UPDATE uploads SET item_local_id = ? WHERE item_local_id = ?', [newLocalId, oldLocalId]);
  }

  /** Uploads that are stuck "uploading" after an app kill go back to pending (they resume). */
  async resetInterrupted(): Promise<void> {
    await this.db.run("UPDATE uploads SET status = 'pending' WHERE status = 'uploading'");
  }

  async clearDone(olderThan: number): Promise<void> {
    await this.db.run("DELETE FROM uploads WHERE status = 'done' AND created_at < ?", [olderThan]);
  }

  async counts(): Promise<{ pending: number; failed: number; blocked: number; uploading: number }> {
    const rows = await this.db.all<{ status: UploadStatus; n: number }>(
      "SELECT status, COUNT(*) AS n FROM uploads WHERE status != 'done' GROUP BY status",
    );
    const out = { pending: 0, failed: 0, blocked: 0, uploading: 0 };
    rows.forEach((r) => {
      if (r.status !== 'done') out[r.status] = r.n;
    });
    return out;
  }
}
