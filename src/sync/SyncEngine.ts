import { SYNC_KEYS, type LocalStore } from '../db/store';
import { normalizeEtag } from '../graph/etag';
import { GraphError } from '../graph/http';
import type { ListClient } from '../graph/lists';
import type { FieldValues } from '../graph/types';
import { buildSchema, type Schema } from '../schema/columnMapper';
import { buildIndexer } from '../schema/search';
import type { SyncContext } from './context';
import { resolveConflict, getConflictView, type Resolution } from './conflicts';
import { syncDown } from './downstream';
import { createLocalItem, deleteLocalItem, updateLocalItem } from './mutations';
import { cleanFields, type DownResult, type UpResult } from './types';
import { syncUp } from './upstream';

export interface SyncEngineDeps {
  store: LocalStore;
  list: ListClient;
  now?: () => number;
  random?: () => number;
  /** How often to re-read the list schema and site users (default 12 h). */
  schemaMaxAgeMs?: number;
  /** Called before each sync (e.g. to resolve site/list IDs once online). */
  prepare?: () => Promise<void>;
}

export interface SyncReport {
  up: UpResult;
  down: DownResult | null;
  startedAt: number;
  finishedAt: number;
}

/**
 * Record sync facade: schema cache, local edits, and the up/down sync cycle.
 * Pure TypeScript (no UI or Expo imports); a single sync runs at a time.
 */
export class SyncEngine {
  private schema: Schema | null = null;
  private running: Promise<SyncReport> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  get store(): LocalStore {
    return this.deps.store;
  }

  /** Forgets the in-memory schema (after sign-out). */
  resetCache(): void {
    this.schema = null;
  }

  /** Schema from the local cache (works offline). */
  async getSchema(): Promise<Schema | null> {
    if (!this.schema) {
      const cols = await this.deps.store.columns.all();
      this.schema = cols.length ? buildSchema(cols) : null;
    }
    return this.schema;
  }

  context(): SyncContext {
    return {
      store: this.deps.store,
      list: this.deps.list,
      now: this.now,
      random: this.deps.random,
      indexer: buildIndexer(this.schema),
    };
  }

  /** Re-reads columns (authoritative schema) and site users when stale or forced. */
  async refreshSchema(force = false): Promise<Schema> {
    const { store, list } = this.deps;
    const last = Number((await store.syncState.get(SYNC_KEYS.lastSchemaSync)) ?? 0);
    const maxAge = this.deps.schemaMaxAgeMs ?? 12 * 3600_000;
    const current = await this.getSchema();
    if (!force && current && this.now() - last < maxAge) return current;

    const columns = await list.getColumns();
    await store.columns.replaceAll(columns);
    try {
      await store.people.replaceAll(await list.getSiteUsers());
    } catch (e) {
      // Person names are a convenience; keep going if the user list is not readable.
      if (!(e instanceof GraphError)) throw e;
      await store.log.add('warn', `Could not load site users: ${e.message}`, this.now());
    }
    const before = JSON.stringify(current?.fields.map((f) => f.name) ?? []);
    this.schema = buildSchema(columns);
    await store.syncState.set(SYNC_KEYS.lastSchemaSync, String(this.now()));
    if (before !== JSON.stringify(this.schema.fields.map((f) => f.name))) await this.reindex();
    return this.schema;
  }

  /** Recomputes search text for all items (after a schema change). */
  async reindex(): Promise<void> {
    const ctx = this.context();
    const items = await ctx.store.items.all();
    await ctx.store.transaction(async () => {
      for (const it of items) await ctx.store.items.upsert(it, ctx.indexer(it.fields));
    });
  }

  /** Push queued changes, then pull server changes. Concurrent calls share one run. */
  sync(): Promise<SyncReport> {
    if (!this.running) {
      this.running = this.runSync().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  get isSyncing(): boolean {
    return this.running !== null;
  }

  private async runSync(): Promise<SyncReport> {
    const startedAt = this.now();
    const { store } = this.deps;
    try {
      await this.deps.prepare?.();
      await this.refreshSchema();
      const up = await syncUp(this.context());
      const down = up.interrupted ? null : await syncDown(this.context());
      await store.syncState.set(SYNC_KEYS.lastSync, new Date(this.now()).toISOString());
      await store.syncState.set(SYNC_KEYS.lastError, null);
      return { up, down, startedAt, finishedAt: this.now() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.syncState.set(SYNC_KEYS.lastError, msg);
      await store.log.add('error', `Sync failed: ${msg}`, this.now());
      throw e;
    }
  }

  // ----- local edits -----

  async createItem(fields: FieldValues): Promise<string> {
    await this.getSchema();
    return createLocalItem(this.context(), fields);
  }

  async updateItem(localId: string, patch: FieldValues): Promise<void> {
    await this.getSchema();
    return updateLocalItem(this.context(), localId, patch);
  }

  async deleteItem(localId: string): Promise<number[]> {
    await this.getSchema();
    return deleteLocalItem(this.context(), localId);
  }

  /**
   * Drops a queued change (e.g. one SharePoint keeps rejecting) and restores the server
   * version of the PO. If the server cannot be reached, the next sync does a full reload.
   */
  async discardChange(outboxId: number): Promise<void> {
    const { store, list } = this.deps;
    const entry = await store.outbox.get(outboxId);
    if (!entry) return;
    await this.getSchema();
    const ctx = this.context();
    if (entry.op === 'create') {
      await deleteLocalItem(ctx, entry.itemLocalId);
      return;
    }
    await store.outbox.remove(outboxId);
    const remaining = await store.outbox.forItem(entry.itemLocalId);
    const spId = entry.op === 'delete' ? String(entry.payload.__spId ?? '') : (await store.items.get(entry.itemLocalId))?.spId;
    if (!spId) return;
    try {
      await this.deps.prepare?.();
      const gi = await list.getItem(spId);
      const fields = cleanFields(gi.fields);
      const existing = await store.items.get(entry.itemLocalId);
      await store.items.upsert(
        {
          localId: existing?.localId ?? spId,
          spId,
          fields: remaining.length && existing ? existing.fields : fields,
          etag: normalizeEtag(gi.eTag) ?? normalizeEtag(gi.fields?.['@odata.etag']),
          modifiedAt: gi.lastModifiedDateTime ?? null,
          modifiedBy: gi.lastModifiedBy?.user?.displayName ?? null,
          createdAt: gi.createdDateTime ?? null,
          dirty: remaining.length > 0,
        },
        ctx.indexer(fields),
      );
    } catch {
      if (!remaining.length) await store.items.setDirty(entry.itemLocalId, false);
      await store.syncState.set(SYNC_KEYS.deltaLink, null);
    }
  }

  getConflict(outboxId: number) {
    return getConflictView(this.context(), outboxId);
  }

  async resolveConflict(outboxId: number, resolution: Resolution): Promise<void> {
    const schema = await this.getSchema();
    const writable = (schema?.fields ?? [])
      .filter((f) => !f.readOnly)
      .map((f) => (f.kind === 'person' ? `${f.name}LookupId` : f.name));
    await resolveConflict(this.context(), outboxId, resolution, writable);
  }
}
