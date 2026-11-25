// Test-only SQL driver backed by Node's built-in SQLite (node:sqlite). Never imported by the app.
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrations';
import type { SqlDriver, SqlValue } from '../db/SqlDriver';
import { LocalStore } from '../db/store';

export function createNodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async transaction(fn) {
      if (depth > 0) throw new Error('Nested transactions are not supported (mirrors expo-sqlite usage).');
      depth++;
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

export async function createTestStore(): Promise<LocalStore> {
  const driver = createNodeDriver();
  await migrate(driver);
  return new LocalStore(driver);
}
