import initSqlJs, { type Database, type SqlValue as SqlJsValue } from 'sql.js';
import { migrate } from './migrations';
import type { SqlDriver, SqlValue } from './SqlDriver';

/**
 * Web database: SQLite compiled to WebAssembly (sql.js), persisted to IndexedDB.
 *
 * expo-sqlite's web build needs SharedArrayBuffer, which requires cross-origin isolation
 * headers (COOP/COEP). Those headers break the Microsoft sign-in pop-up and many static
 * hosts cannot set them, so the web app uses sql.js instead. The SQL and repositories are
 * the same as on iOS/Android.
 */

const IDB_NAME = 'potracker-db';
const IDB_STORE = 'files';
const IDB_KEY = 'potracker.sqlite';
const SAVE_DELAY_MS = 400;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const db = await idb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function createSqlJsDriver(db: Database): SqlDriver {
  let depth = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const flush = async () => {
    timer = null;
    if (!dirty || depth > 0) return;
    dirty = false;
    await saveBytes(db.export());
  };
  const scheduleSave = () => {
    dirty = true;
    if (depth > 0) return; // saved after commit
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }

  const params = (p: SqlValue[] = []) => p as SqlJsValue[];

  return {
    async exec(sql) {
      db.exec(sql);
      if (!/^\s*(select|pragma\s+\w+\s*$)/i.test(sql)) scheduleSave();
    },
    async run(sql, p) {
      db.run(sql, params(p));
      const changes = db.getRowsModified();
      const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
      scheduleSave();
      return { changes, lastInsertRowId: Number(id ?? 0) };
    },
    async all<T>(sql: string, p?: SqlValue[]) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params(p));
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async get<T>(sql: string, p?: SqlValue[]) {
      const rows = await this.all<T>(sql, p);
      return rows[0] ?? null;
    },
    async transaction(fn) {
      if (depth > 0) throw new Error('Nested transactions are not supported.');
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
      scheduleSave();
    },
  };
}

let opening: Promise<SqlDriver> | null = null;

export function openAppDatabase(): Promise<SqlDriver> {
  if (!opening) {
    opening = (async () => {
      // The .wasm file is copied to /public by scripts/copy-sqljs-wasm.js (postinstall).
      const SQL = await initSqlJs({ locateFile: () => '/sql-wasm-browser.wasm' });
      const bytes = await loadBytes();
      const driver = createSqlJsDriver(bytes ? new SQL.Database(bytes) : new SQL.Database());
      await migrate(driver);
      return driver;
    })().catch((e: unknown) => {
      opening = null;
      throw e;
    });
  }
  return opening;
}
