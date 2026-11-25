import NetInfo from '@react-native-community/netinfo';
import { signOutTokens, tokenManager } from '../auth/authService';
import { AuthRequiredError } from '../auth/types';
import { getConfig } from '../config/env';
import { openAppDatabase } from '../db/expoDriver';
import { LocalStore, SYNC_KEYS } from '../db/store';
import { clearLocalFiles, fileSource } from '../documents/localFiles';
import { UploadEngine } from '../documents/UploadEngine';
import { DriveApi } from '../graph/drive';
import { GraphHttp } from '../graph/http';
import { getMe, ListsApi, type ListClient } from '../graph/lists';
import { findDriveByName, findListByName, getSiteByPath } from '../graph/sites';
import type { GraphUser } from '../graph/types';
import { initNotifications, showNotice } from '../notifications/notifier';
import {
  DEFAULT_PREFS,
  evaluateChanges,
  evaluateDaily,
  evaluateSyncProblems,
  myLookupIds,
  type Notice,
  type NotificationPrefs,
  type RuleContext,
} from '../notifications/rules';
import { todayYmd } from '../schema/dates';
import { fieldKey } from '../schema/values';
import { SyncEngine, type SyncReport } from '../sync/SyncEngine';

export type SyncReason = 'start' | 'reconnect' | 'foreground' | 'manual' | 'local-save' | 'background' | 'timer';

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  uploading: boolean;
  lastSync: string | null;
  lastError: string | null;
  pendingChanges: number;
  failedChanges: number;
  conflicts: number;
  pendingUploads: number;
  failedUploads: number;
  blockedUploads: number;
  uploadProgress: Record<number, { sent: number; total: number }>;
}

const META = { siteId: 'siteId', listId: 'listId', driveId: 'driveId', me: 'me' } as const;
const SETTINGS = { prefs: 'notificationPrefs', lastDaily: 'lastDailyAlerts' } as const;

type Listener = () => void;

/**
 * Composition root: database, Graph client, sync and upload engines, notifications.
 * One instance per JS runtime (the UI and the background task each get one).
 */
export class AppServices {
  readonly engine: SyncEngine;
  readonly uploads: UploadEngine;
  private listApi: ListsApi | null = null;
  private driveApi: DriveApi | null = null;
  private statusListeners = new Set<Listener>();
  private dataListeners = new Set<Listener>();
  private authRequiredListeners = new Set<Listener>();
  private _status: SyncStatus = {
    online: true,
    syncing: false,
    uploading: false,
    lastSync: null,
    lastError: null,
    pendingChanges: 0,
    failedChanges: 0,
    conflicts: 0,
    pendingUploads: 0,
    failedUploads: 0,
    blockedUploads: 0,
    uploadProgress: {},
  };
  private cycle: Promise<void> | null = null;

  constructor(readonly store: LocalStore, readonly http: GraphHttp) {
    const lazyList = this.lazyListClient();
    this.engine = new SyncEngine({ store, list: lazyList, prepare: () => this.prepare() });
    this.uploads = new UploadEngine({
      store,
      drive: () => this.getDrive(),
      files: fileSource,
      baseFolder: getConfig().baseFolder,
      folderValue: async (item) => {
        const schema = await this.engine.getSchema();
        const def = schema?.bySemantic.folder;
        const v = def ? item.fields[fieldKey(def)] : item.fields.Title;
        return v === null || v === undefined ? null : String(v);
      },
      onProgress: (id, sent, total) => {
        this.setStatus({ uploadProgress: { ...this._status.uploadProgress, [id]: { sent, total } } });
      },
    });
  }

  // ----- connection to SharePoint -----

  /** ListClient that resolves site/list IDs on first use (cached in SQLite). */
  private lazyListClient(): ListClient {
    const api = () => {
      if (!this.listApi) throw new Error('Not connected to SharePoint yet.');
      return this.listApi;
    };
    return {
      getColumns: () => api().getColumns(),
      firstItemsUrl: (n) => api().firstItemsUrl(n),
      deltaStartUrl: () => api().deltaStartUrl(),
      deltaLatestUrl: () => api().deltaLatestUrl(),
      getPage: (u) => api().getPage(u),
      getItem: (id) => api().getItem(id),
      createItem: (f) => api().createItem(f),
      updateFields: (id, f, e) => api().updateFields(id, f, e),
      deleteItem: (id, e) => api().deleteItem(id, e),
      getSiteUsers: () => api().getSiteUsers(),
    };
  }

  /** Resolves and caches the site ID, list ID and the signed-in user. */
  async prepare(): Promise<void> {
    if (this.listApi) return;
    const cfg = getConfig();
    let siteId = await this.store.meta.get(META.siteId);
    let listId = await this.store.meta.get(META.listId);
    if (!siteId || !listId) {
      siteId = (await getSiteByPath(this.http, cfg.siteHost, cfg.sitePath)).id;
      listId = (await findListByName(this.http, siteId, cfg.listName)).id;
      await this.store.meta.set(META.siteId, siteId);
      await this.store.meta.set(META.listId, listId);
    }
    if (!(await this.store.meta.get(META.me))) {
      await this.store.meta.setJson(META.me, await getMe(this.http));
    }
    this.listApi = new ListsApi(this.http, siteId, listId);
  }

  /** Document library client; throws LibraryNotFoundError with guidance if it is missing. */
  async getDrive(): Promise<DriveApi> {
    if (this.driveApi) return this.driveApi;
    await this.prepare();
    let driveId = await this.store.meta.get(META.driveId);
    if (!driveId) {
      const siteId = (await this.store.meta.get(META.siteId))!;
      driveId = (await findDriveByName(this.http, siteId, getConfig().libraryName)).id;
      await this.store.meta.set(META.driveId, driveId);
    }
    this.driveApi = new DriveApi(this.http, driveId);
    return this.driveApi;
  }

  async me(): Promise<GraphUser | null> {
    return this.store.meta.getJson<GraphUser>(META.me);
  }

  isSignedIn(): Promise<boolean> {
    return tokenManager.hasSession();
  }

  // ----- status & change notifications for the UI -----

  get status(): SyncStatus {
    return this._status;
  }

  onStatus(l: Listener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  /** Fires when the Microsoft session can no longer be refreshed (user must sign in again). */
  onAuthRequired(l: Listener): () => void {
    this.authRequiredListeners.add(l);
    return () => this.authRequiredListeners.delete(l);
  }

  onDataChanged(l: Listener): () => void {
    this.dataListeners.add(l);
    return () => this.dataListeners.delete(l);
  }

  notifyDataChanged(): void {
    this.dataListeners.forEach((l) => l());
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this._status = { ...this._status, ...patch };
    this.statusListeners.forEach((l) => l());
  }

  async refreshStatus(): Promise<void> {
    const o = await this.store.outbox.counts();
    const u = await this.store.uploads.counts();
    this.setStatus({
      lastSync: await this.store.syncState.get(SYNC_KEYS.lastSync),
      lastError: await this.store.syncState.get(SYNC_KEYS.lastError),
      pendingChanges: o.pending,
      failedChanges: o.failed,
      conflicts: o.conflict,
      pendingUploads: u.pending + u.uploading,
      failedUploads: u.failed,
      blockedUploads: u.blocked,
    });
  }

  setOnline(online: boolean): void {
    if (online !== this._status.online) this.setStatus({ online });
  }

  // ----- the sync cycle -----

  /**
   * Push record changes, pull SharePoint changes, send queued uploads, raise alerts.
   * Concurrent calls share one cycle.
   */
  runCycle(reason: SyncReason): Promise<void> {
    if (!this.cycle) {
      this.cycle = this.doCycle(reason).finally(() => {
        this.cycle = null;
      });
    }
    return this.cycle;
  }

  private async doCycle(reason: SyncReason): Promise<void> {
    const net = await NetInfo.fetch();
    const online = net.isConnected !== false && net.isInternetReachable !== false;
    this.setOnline(online);
    if (!online && reason !== 'manual') {
      await this.refreshStatus();
      return;
    }
    if (!(await this.isSignedIn())) return;

    this.setStatus({ syncing: true });
    let report: SyncReport | null = null;
    try {
      report = await this.engine.sync();
    } catch (e) {
      // lastError is recorded by the engine and shown on the Sync screen.
      if (e instanceof AuthRequiredError) {
        this.setStatus({ syncing: false });
        this.authRequiredListeners.forEach((l) => l());
        return;
      }
    } finally {
      this.setStatus({ syncing: false });
      await this.refreshStatus();
      this.notifyDataChanged();
    }

    this.setStatus({ uploading: true });
    try {
      await this.uploads.process();
    } catch (e) {
      await this.store.log.add('error', `Uploads failed: ${e instanceof Error ? e.message : String(e)}`, Date.now());
    } finally {
      this.setStatus({ uploading: false, uploadProgress: {} });
      await this.refreshStatus();
      this.notifyDataChanged();
    }

    try {
      await this.raiseAlerts(report);
    } catch {
      // Alerts must never break sync.
    }
  }

  // ----- notifications -----

  async getPrefs(): Promise<NotificationPrefs> {
    return { ...DEFAULT_PREFS, ...((await this.store.settings.getJson<NotificationPrefs>(SETTINGS.prefs)) ?? {}) };
  }

  async setPrefs(p: NotificationPrefs): Promise<void> {
    await this.store.settings.setJson(SETTINGS.prefs, p);
  }

  private async ruleContext(): Promise<RuleContext | null> {
    const schema = await this.engine.getSchema();
    if (!schema) return null;
    const me = await this.me();
    const people = await this.store.people.all();
    const names: Record<string, string> = {};
    people.forEach((p) => (names[p.lookupId] = p.name));
    return {
      schema,
      timeZone: getConfig().siteTimeZone,
      people: names,
      myLookupIds: myLookupIds(people, [me?.mail ?? '', me?.userPrincipalName ?? '']),
      myDisplayName: me?.displayName ?? null,
    };
  }

  private async raiseAlerts(report: SyncReport | null): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs.enabled) return;
    const rc = await this.ruleContext();
    if (!rc) return;
    const tz = getConfig().siteTimeZone;
    const today = todayYmd(tz);
    const notices: Notice[] = [];

    if (report?.down?.mode === 'delta') notices.push(...evaluateChanges(report.down.changes, prefs, rc));

    // Date-based alerts at most every 6 hours.
    const lastDaily = Number((await this.store.settings.get(SETTINGS.lastDaily)) ?? 0);
    if (Date.now() - lastDaily > 6 * 3600_000) {
      notices.push(...evaluateDaily(await this.store.items.all(), prefs, rc, today));
      await this.store.settings.set(SETTINGS.lastDaily, String(Date.now()));
    }
    const s = this._status;
    notices.push(
      ...evaluateSyncProblems(
        { conflicts: s.conflicts, failedChanges: s.failedChanges, failedUploads: s.failedUploads },
        prefs,
        today,
      ),
    );

    const fresh: Notice[] = [];
    for (const n of notices) {
      if (await this.store.notificationLog.has(n.key)) continue;
      await this.store.notificationLog.add(n.key, Date.now());
      fresh.push(n);
    }
    await this.store.notificationLog.prune(Date.now() - 120 * 86_400_000);
    if (!fresh.length) return;

    await initNotifications();
    if (fresh.length > 3) {
      // Avoid a burst of banners: one summary instead.
      await showNotice({
        key: `summary:${Date.now()}`,
        title: `${fresh.length} PO updates`,
        body: fresh
          .slice(0, 3)
          .map((n) => n.title)
          .join(' · ') + ' …',
      });
    } else {
      for (const n of fresh) await showNotice(n);
    }
  }

  // ----- sign-out -----

  /** Clears tokens, the local database and queued files. */
  async signOut(): Promise<void> {
    await this.store.clearAll();
    await clearLocalFiles().catch(() => undefined);
    await signOutTokens();
    this.listApi = null;
    this.driveApi = null;
    this.engine.resetCache();
    await this.refreshStatus();
    this.notifyDataChanged();
  }
}

let instance: Promise<AppServices> | null = null;

export function getServices(): Promise<AppServices> {
  if (!instance) {
    instance = (async () => {
      const db = await openAppDatabase();
      const store = new LocalStore(db);
      const http = new GraphHttp({ getToken: (o) => tokenManager.getAccessToken(o) });
      const services = new AppServices(store, http);
      await services.refreshStatus();
      // Development builds only: handle for debugging from the browser console / devtools.
      if (__DEV__) (globalThis as { __poServices?: AppServices }).__poServices = services;
      return services;
    })().catch((e: unknown) => {
      instance = null;
      throw e;
    });
  }
  return instance;
}
