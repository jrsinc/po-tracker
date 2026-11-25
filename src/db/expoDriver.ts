import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqlDriver, SqlValue } from './SqlDriver';

/** expo-sqlite implementation of SqlDriver (works on iOS, Android and web). */
export function createExpoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params: SqlValue[] = []) {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    get: <T>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
    transaction: (fn) => db.withTransactionAsync(fn),
  };
}

let opening: Promise<SqlDriver> | null = null;

/** Opens (once) and migrates the app database. */
export function openAppDatabase(): Promise<SqlDriver> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('potracker.db');
      try {
        await db.execAsync('PRAGMA journal_mode = WAL;');
      } catch {
        // Not available on every backend (e.g. web); the default journal is fine.
      }
      const driver = createExpoDriver(db);
      await migrate(driver);
      return driver;
    })().catch((e: unknown) => {
      opening = null;
      throw e;
    });
  }
  return opening;
}
