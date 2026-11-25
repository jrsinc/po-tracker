import type { SqlDriver } from './SqlDriver';

/** Ordered schema migrations. Never edit a shipped migration; append a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS columns (
    name TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    def_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    local_id TEXT PRIMARY KEY NOT NULL,
    sp_id TEXT UNIQUE,
    fields_json TEXT NOT NULL,
    etag TEXT,
    modified_at TEXT,
    modified_by TEXT,
    created_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_items_modified ON items(modified_at);

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_local_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('create','update','delete')),
    payload_json TEXT NOT NULL,
    base_etag TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','conflict')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_item ON outbox(item_local_id);

  CREATE TABLE IF NOT EXISTS conflicts (
    outbox_id INTEGER PRIMARY KEY NOT NULL,
    server_fields_json TEXT,
    server_etag TEXT,
    server_deleted INTEGER NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_local_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    target_name TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','done','failed','blocked')),
    session_url TEXT,
    session_expires TEXT,
    bytes_sent INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    remote_item_id TEXT,
    remote_name TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_uploads_item ON uploads(item_local_id);

  CREATE TABLE IF NOT EXISTS doc_cache (
    folder TEXT NOT NULL,
    drive_item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER,
    web_url TEXT,
    mime_type TEXT,
    modified_at TEXT,
    modified_by TEXT,
    local_uri TEXT,
    PRIMARY KEY (folder, drive_item_id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people (
    lookup_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    key TEXT PRIMARY KEY NOT NULL,
    sent_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // v-next: values the fields had before a queued update (to tell real conflicts from version bumps)
  'ALTER TABLE outbox ADD COLUMN base_json TEXT;',
];

export async function migrate(db: SqlDriver): Promise<void> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[v]!);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Every table holding user data (cleared on sign-out). */
export const DATA_TABLES = [
  'meta',
  'columns',
  'items',
  'outbox',
  'conflicts',
  'uploads',
  'doc_cache',
  'sync_state',
  'sync_log',
  'people',
  'notification_log',
  'settings',
];

export async function clearAllData(db: SqlDriver): Promise<void> {
  await db.transaction(async () => {
    for (const t of DATA_TABLES) await db.exec(`DELETE FROM ${t}`);
  });
}
