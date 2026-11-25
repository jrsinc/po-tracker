import type { LocalStore } from '../db/store';
import type { FieldValues } from '../graph/types';
import type { ListClient } from '../graph/lists';

/** Everything the record sync engine needs. No UI or Expo imports. */
export interface SyncContext {
  store: LocalStore;
  list: ListClient;
  now: () => number;
  random?: () => number;
  /** Builds the lower-cased search text for an item (depends on the schema). */
  indexer: (fields: FieldValues) => string;
}
