import type { ColumnDefinition } from '../../graph/types';
import type { SqlDriver } from '../SqlDriver';

/** Key/value tables: meta (resolved IDs, user), sync_state (delta link, times), settings. */
export class KvRepo {
  constructor(private readonly db: SqlDriver, private readonly table: 'meta' | 'sync_state' | 'settings') {}

  async get(key: string): Promise<string | null> {
    const r = await this.db.get<{ value: string | null }>(`SELECT value FROM ${this.table} WHERE key = ?`, [key]);
    return r?.value ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.db.run(`DELETE FROM ${this.table} WHERE key = ?`, [key]);
    } else {
      await this.db.run(`INSERT OR REPLACE INTO ${this.table} (key, value) VALUES (?, ?)`, [key, value]);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const v = await this.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.set(key, value === null || value === undefined ? null : JSON.stringify(value));
  }
}

export class ColumnsRepo {
  constructor(private readonly db: SqlDriver) {}

  async replaceAll(columns: ColumnDefinition[]): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM columns');
      let i = 0;
      for (const c of columns) {
        await this.db.run('INSERT OR REPLACE INTO columns (name, display_name, position, def_json) VALUES (?, ?, ?, ?)', [
          c.name,
          c.displayName,
          i++,
          JSON.stringify(c),
        ]);
      }
    });
  }

  async all(): Promise<ColumnDefinition[]> {
    const rows = await this.db.all<{ def_json: string }>('SELECT def_json FROM columns ORDER BY position');
    return rows.map((r) => JSON.parse(r.def_json) as ColumnDefinition);
  }
}

export interface Person {
  lookupId: string;
  name: string;
  email: string | null;
}

export class PeopleRepo {
  constructor(private readonly db: SqlDriver) {}

  async replaceAll(people: Person[]): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM people');
      for (const p of people) {
        await this.db.run('INSERT OR REPLACE INTO people (lookup_id, name, email) VALUES (?, ?, ?)', [p.lookupId, p.name, p.email]);
      }
    });
  }

  async all(): Promise<Person[]> {
    const rows = await this.db.all<{ lookup_id: string; name: string; email: string | null }>(
      'SELECT * FROM people ORDER BY name',
    );
    return rows.map((r) => ({ lookupId: r.lookup_id, name: r.name, email: r.email }));
  }

  async nameMap(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    (await this.all()).forEach((p) => (out[p.lookupId] = p.name));
    return out;
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

export class SyncLogRepo {
  constructor(private readonly db: SqlDriver) {}

  async add(level: LogLevel, message: string, at: number): Promise<void> {
    await this.db.run('INSERT INTO sync_log (at, level, message) VALUES (?, ?, ?)', [at, level, message]);
    await this.db.run('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 200)');
  }

  async recent(limit = 50): Promise<{ id: number; at: number; level: LogLevel; message: string }[]> {
    return this.db.all('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?', [limit]);
  }
}

export class NotificationLogRepo {
  constructor(private readonly db: SqlDriver) {}

  async has(key: string): Promise<boolean> {
    return !!(await this.db.get('SELECT key FROM notification_log WHERE key = ?', [key]));
  }

  async add(key: string, at: number): Promise<void> {
    await this.db.run('INSERT OR REPLACE INTO notification_log (key, sent_at) VALUES (?, ?)', [key, at]);
  }

  async prune(olderThan: number): Promise<void> {
    await this.db.run('DELETE FROM notification_log WHERE sent_at < ?', [olderThan]);
  }
}

export interface CachedDoc {
  folder: string;
  driveItemId: string;
  name: string;
  size: number | null;
  webUrl: string | null;
  mimeType: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
  localUri: string | null;
}

export class DocCacheRepo {
  constructor(private readonly db: SqlDriver) {}

  async forFolder(folder: string): Promise<CachedDoc[]> {
    const rows = await this.db.all<{
      folder: string;
      drive_item_id: string;
      name: string;
      size: number | null;
      web_url: string | null;
      mime_type: string | null;
      modified_at: string | null;
      modified_by: string | null;
      local_uri: string | null;
    }>('SELECT * FROM doc_cache WHERE folder = ? ORDER BY name COLLATE NOCASE', [folder]);
    return rows.map((r) => ({
      folder: r.folder,
      driveItemId: r.drive_item_id,
      name: r.name,
      size: r.size,
      webUrl: r.web_url,
      mimeType: r.mime_type,
      modifiedAt: r.modified_at,
      modifiedBy: r.modified_by,
      localUri: r.local_uri,
    }));
  }

  /** Replaces the cached listing for a folder, keeping known local copies. */
  async replaceFolder(folder: string, docs: Omit<CachedDoc, 'localUri'>[]): Promise<void> {
    const existing = new Map((await this.forFolder(folder)).map((d) => [d.driveItemId, d.localUri]));
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM doc_cache WHERE folder = ?', [folder]);
      for (const d of docs) await this.insert({ ...d, localUri: existing.get(d.driveItemId) ?? null });
    });
  }

  async insert(d: CachedDoc): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO doc_cache (folder, drive_item_id, name, size, web_url, mime_type, modified_at, modified_by, local_uri)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.folder, d.driveItemId, d.name, d.size, d.webUrl, d.mimeType, d.modifiedAt, d.modifiedBy, d.localUri],
    );
  }

  async setLocalUri(folder: string, driveItemId: string, uri: string | null): Promise<void> {
    await this.db.run('UPDATE doc_cache SET local_uri = ? WHERE folder = ? AND drive_item_id = ?', [uri, folder, driveItemId]);
  }
}
