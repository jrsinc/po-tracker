import { clearAllData } from './migrations';
import { ItemsRepo } from './repositories/items';
import {
  ColumnsRepo,
  DocCacheRepo,
  KvRepo,
  NotificationLogRepo,
  PeopleRepo,
  SyncLogRepo,
} from './repositories/misc';
import { OutboxRepo } from './repositories/outbox';
import { UploadsRepo } from './repositories/uploads';
import type { SqlDriver } from './SqlDriver';

/** All repositories over one database connection. */
export class LocalStore {
  readonly items: ItemsRepo;
  readonly outbox: OutboxRepo;
  readonly uploads: UploadsRepo;
  readonly columns: ColumnsRepo;
  readonly people: PeopleRepo;
  readonly docs: DocCacheRepo;
  readonly meta: KvRepo;
  readonly syncState: KvRepo;
  readonly settings: KvRepo;
  readonly log: SyncLogRepo;
  readonly notificationLog: NotificationLogRepo;

  constructor(readonly db: SqlDriver) {
    this.items = new ItemsRepo(db);
    this.outbox = new OutboxRepo(db);
    this.uploads = new UploadsRepo(db);
    this.columns = new ColumnsRepo(db);
    this.people = new PeopleRepo(db);
    this.docs = new DocCacheRepo(db);
    this.meta = new KvRepo(db, 'meta');
    this.syncState = new KvRepo(db, 'sync_state');
    this.settings = new KvRepo(db, 'settings');
    this.log = new SyncLogRepo(db);
    this.notificationLog = new NotificationLogRepo(db);
  }

  transaction(fn: () => Promise<void>): Promise<void> {
    return this.db.transaction(fn);
  }

  clearAll(): Promise<void> {
    return clearAllData(this.db);
  }
}

export const SYNC_KEYS = {
  deltaLink: 'deltaLink',
  lastSync: 'lastSync',
  lastFullSync: 'lastFullSync',
  lastSchemaSync: 'lastSchemaSync',
  lastError: 'lastError',
} as const;
