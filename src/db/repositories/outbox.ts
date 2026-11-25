import type { FieldValues } from '../../graph/types';
import type { SqlDriver } from '../SqlDriver';

export type OutboxOp = 'create' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'failed' | 'conflict';

export interface OutboxEntry {
  id: number;
  itemLocalId: string;
  op: OutboxOp;
  /** Graph field payload (create/update). */
  payload: FieldValues;
  /** eTag the change was based on (sent as If-Match). */
  baseEtag: string | null;
  /** Values the changed fields had before the change (null for older entries). */
  base: FieldValues | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  createdAt: number;
}

export interface ConflictRecord {
  outboxId: number;
  serverFields: FieldValues | null;
  serverEtag: string | null;
  serverDeleted: boolean;
  fetchedAt: number;
}

interface Row {
  id: number;
  item_local_id: string;
  op: OutboxOp;
  payload_json: string;
  base_etag: string | null;
  base_json?: string | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: number;
  created_at: number;
}

function fromRow(r: Row): OutboxEntry {
  return {
    id: r.id,
    itemLocalId: r.item_local_id,
    op: r.op,
    payload: JSON.parse(r.payload_json) as FieldValues,
    baseEtag: r.base_etag,
    base: r.base_json ? (JSON.parse(r.base_json) as FieldValues) : null,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    createdAt: r.created_at,
  };
}

export class OutboxRepo {
  constructor(private readonly db: SqlDriver) {}

  async add(e: { itemLocalId: string; op: OutboxOp; payload: FieldValues; baseEtag: string | null; base?: FieldValues | null; now: number }): Promise<number> {
    const r = await this.db.run(
      `INSERT INTO outbox (item_local_id, op, payload_json, base_etag, base_json, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, ?)`,
      [e.itemLocalId, e.op, JSON.stringify(e.payload), e.baseEtag, e.base ? JSON.stringify(e.base) : null, e.now],
    );
    return r.lastInsertRowId;
  }

  async get(id: number): Promise<OutboxEntry | null> {
    const r = await this.db.get<Row>('SELECT * FROM outbox WHERE id = ?', [id]);
    return r ? fromRow(r) : null;
  }

  /** All entries in queue order. */
  async all(): Promise<OutboxEntry[]> {
    return (await this.db.all<Row>('SELECT * FROM outbox ORDER BY id')).map(fromRow);
  }

  async forItem(itemLocalId: string): Promise<OutboxEntry[]> {
    return (await this.db.all<Row>('SELECT * FROM outbox WHERE item_local_id = ? ORDER BY id', [itemLocalId])).map(fromRow);
  }

  async setPayload(id: number, payload: FieldValues, base?: FieldValues | null): Promise<void> {
    if (base === undefined) {
      await this.db.run('UPDATE outbox SET payload_json = ? WHERE id = ?', [JSON.stringify(payload), id]);
    } else {
      await this.db.run('UPDATE outbox SET payload_json = ?, base_json = ? WHERE id = ?', [JSON.stringify(payload), base ? JSON.stringify(base) : null, id]);
    }
  }

  async markFailed(id: number, error: string, nextAttemptAt: number, status: OutboxStatus = 'failed'): Promise<void> {
    await this.db.run(
      'UPDATE outbox SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?',
      [status, error, nextAttemptAt, id],
    );
  }

  async markRetryLater(id: number, error: string, nextAttemptAt: number): Promise<void> {
    await this.db.run(
      "UPDATE outbox SET status = 'pending', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
      [error, nextAttemptAt, id],
    );
  }

  async markConflict(id: number, error: string): Promise<void> {
    await this.db.run("UPDATE outbox SET status = 'conflict', last_error = ? WHERE id = ?", [error, id]);
  }

  /** Resets a failed/conflict entry so it is sent again on the next sync. */
  async retry(id: number, baseEtag?: string | null): Promise<void> {
    if (baseEtag !== undefined) {
      await this.db.run(
        "UPDATE outbox SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = 0, base_etag = ? WHERE id = ?",
        [baseEtag, id],
      );
    } else {
      await this.db.run(
        "UPDATE outbox SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = 0 WHERE id = ?",
        [id],
      );
    }
  }

  async retryAllFailed(): Promise<void> {
    await this.db.run("UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status = 'failed'");
    await this.db.run('UPDATE outbox SET next_attempt_at = 0');
  }

  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM outbox WHERE id = ?', [id]);
    await this.db.run('DELETE FROM conflicts WHERE outbox_id = ?', [id]);
  }

  async removeForItem(itemLocalId: string): Promise<void> {
    await this.db.run('DELETE FROM conflicts WHERE outbox_id IN (SELECT id FROM outbox WHERE item_local_id = ?)', [itemLocalId]);
    await this.db.run('DELETE FROM outbox WHERE item_local_id = ?', [itemLocalId]);
  }

  async remapItem(oldLocalId: string, newLocalId: string): Promise<void> {
    await this.db.run('UPDATE outbox SET item_local_id = ? WHERE item_local_id = ?', [newLocalId, oldLocalId]);
  }

  async counts(): Promise<{ pending: number; failed: number; conflict: number }> {
    const rows = await this.db.all<{ status: OutboxStatus; n: number }>(
      'SELECT status, COUNT(*) AS n FROM outbox GROUP BY status',
    );
    const out = { pending: 0, failed: 0, conflict: 0 };
    rows.forEach((r) => (out[r.status] = r.n));
    return out;
  }

  // ----- conflicts -----

  async saveConflict(c: ConflictRecord): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO conflicts (outbox_id, server_fields_json, server_etag, server_deleted, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [c.outboxId, c.serverFields ? JSON.stringify(c.serverFields) : null, c.serverEtag, c.serverDeleted ? 1 : 0, c.fetchedAt],
    );
  }

  async getConflict(outboxId: number): Promise<ConflictRecord | null> {
    const r = await this.db.get<{
      outbox_id: number;
      server_fields_json: string | null;
      server_etag: string | null;
      server_deleted: number;
      fetched_at: number;
    }>('SELECT * FROM conflicts WHERE outbox_id = ?', [outboxId]);
    if (!r) return null;
    return {
      outboxId: r.outbox_id,
      serverFields: r.server_fields_json ? (JSON.parse(r.server_fields_json) as FieldValues) : null,
      serverEtag: r.server_etag,
      serverDeleted: r.server_deleted === 1,
      fetchedAt: r.fetched_at,
    };
  }
}
