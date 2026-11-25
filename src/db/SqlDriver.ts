export type SqlValue = string | number | null;

/**
 * Minimal SQL interface used by the repositories. The app uses expo-sqlite (native and web);
 * unit tests use Node's built-in node:sqlite, so repositories and engines are tested against
 * real SQL without a device.
 */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs fn inside a transaction; rolls back if it throws. */
  transaction(fn: () => Promise<void>): Promise<void>;
}
