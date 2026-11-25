import { SYNC_KEYS, type LocalStore } from '../../db/store';
import { GraphError } from '../../graph/http';
import { createTestStore } from '../../testing/nodeDriver';
import { FakeList, offline } from '../../testing/fakeList';
import { SyncEngine } from '../SyncEngine';
import { isTempId } from '../types';

let store: LocalStore;
let server: FakeList;
let engine: SyncEngine;
let now: number;

beforeEach(async () => {
  store = await createTestStore();
  server = new FakeList();
  now = Date.parse('2026-11-24T12:00:00Z');
  engine = new SyncEngine({ store, list: server, now: () => now, random: () => 0.5 });
});

async function seed(n: number) {
  for (let i = 1; i <= n; i++) {
    server.serverCreate({ Title: String(900 + i), Status: 'Active', Customer: 'Rigen Pharma', CustomerPO: `PO-${i}` });
  }
}

describe('downstream: full load', () => {
  it('loads every page, stores eTags and fields, and saves a delta link', async () => {
    await seed(5);
    const report = await engine.sync();
    expect(report.down?.mode).toBe('full');
    expect(await store.items.count()).toBe(5);
    const item = await store.items.getBySpId('3');
    expect(item?.fields.Title).toBe('903');
    expect(item?.fields['@odata.etag']).toBeUndefined();
    expect(item?.etag).toBe(server.etagOf('3'));
    expect(await store.syncState.get(SYNC_KEYS.deltaLink)).toMatch(/^delta\?token=/);
    // 5 items, page size 2 -> 3 item pages
    expect(server.calls.filter((c) => c.startsWith('GET items')).length).toBe(3);
  });

  it('builds search text from the schema (folder #, customer, PO#)', async () => {
    await seed(2);
    await engine.sync();
    const hits = await store.items.query({ search: 'po-2' });
    expect(hits.map((h) => h.spId)).toEqual(['2']);
    expect((await store.items.query({ search: 'rigen 901' })).map((h) => h.spId)).toEqual(['1']);
  });

  it('falls back to enumerating delta when token=latest is not supported', async () => {
    server.supportsLatestToken = false;
    await seed(3);
    await engine.sync();
    expect(await store.items.count()).toBe(3);
    expect(await store.syncState.get(SYNC_KEYS.deltaLink)).toMatch(/^delta\?token=/);
    expect(server.calls.some((c) => c.startsWith('GET delta?start'))).toBe(true);
  });

  it('removes local items that no longer exist on the server', async () => {
    await seed(3);
    await engine.sync();
    server.serverDelete('2');
    await store.syncState.set(SYNC_KEYS.deltaLink, null); // force a full load
    await engine.sync();
    expect(await store.items.getBySpId('2')).toBeNull();
    expect(await store.items.count()).toBe(2);
  });
});

describe('downstream: delta', () => {
  it('applies creates, updates and deletes and reports them as change events', async () => {
    await seed(3);
    await engine.sync();
    server.serverEdit('1', { Status: 'Completed' });
    server.serverDelete('2');
    const newId = server.serverCreate({ Title: '999', Status: 'Active' });

    const report = await engine.sync();
    expect(report.down?.mode).toBe('delta');
    const kinds = Object.fromEntries(report.down!.changes.map((c) => [c.spId, c.kind]));
    expect(kinds).toEqual({ '1': 'updated', '2': 'deleted', [newId]: 'created' });

    const updated = report.down!.changes.find((c) => c.spId === '1')!;
    expect(updated.before?.Status).toBe('Active');
    expect(updated.after?.Status).toBe('Completed');
    expect((await store.items.getBySpId('1'))?.fields.Status).toBe('Completed');
    expect(await store.items.getBySpId('2')).toBeNull();
    expect((await store.items.getBySpId(newId))?.fields.Title).toBe('999');
  });

  it('does not overwrite an item that has unsynced local edits', async () => {
    await seed(1);
    await engine.sync();
    server.failNext('update', offline()); // keep the local edit queued
    await engine.updateItem('1', { Status: 'Stored' });
    server.serverEdit('1', { Status: 'Cancelled' });
    await engine.sync();
    const local = await store.items.getBySpId('1');
    expect(local?.fields.Status).toBe('Stored');
    expect(local?.dirty).toBe(true);
  });

  it('falls back to a full resync when the delta token has expired', async () => {
    await seed(2);
    await engine.sync();
    const link = (await store.syncState.get(SYNC_KEYS.deltaLink))!;
    server.expiredTokens.add(/token=(\d+)/.exec(link)![1]!);
    server.serverCreate({ Title: '950' });

    const report = await engine.sync();
    expect(report.down?.mode).toBe('full');
    expect(await store.items.count()).toBe(3);
    const newLink = await store.syncState.get(SYNC_KEYS.deltaLink);
    expect(newLink).not.toBe(link);
    const logs = await store.log.recent();
    expect(logs.some((l) => /expired/i.test(l.message))).toBe(true);
  });
});

describe('upstream: outbox', () => {
  it('sends queued changes in order with If-Match carrying the stored eTag', async () => {
    await seed(2);
    await engine.sync();
    const etag1 = (await store.items.getBySpId('1'))!.etag;
    await engine.updateItem('1', { Status: 'Completed' });
    await engine.updateItem('2', { Status: 'Stored' });
    const localId = await engine.createItem({ Title: '777' });
    server.calls = [];

    await engine.sync();
    const writes = server.calls.filter((c) => /^(PATCH|POST|DELETE)/.test(c));
    expect(writes[0]).toBe(`PATCH 1 ${etag1} {"Status":"Completed"}`);
    expect(writes[1]).toMatch(/^PATCH 2 /);
    expect(writes[2]).toMatch(/^POST /);
    expect(await store.outbox.all()).toEqual([]);
    expect(await store.items.get(localId)).toBeNull(); // remapped to the SharePoint id
  });

  it('merges consecutive edits to the same item into one queued update', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    await engine.updateItem('1', { CustomerPO: 'X-1' });
    const queued = await store.outbox.all();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ Status: 'Completed', CustomerPO: 'X-1' });
  });

  it('keeps later entries for an item behind an earlier failed one, but still sends other items', async () => {
    await seed(2);
    await engine.sync();
    server.failNext('update', new GraphError(400, 'invalidRequest', 'Bad value'));
    await engine.updateItem('1', { Status: 'Bad' });
    await engine.updateItem('2', { Status: 'Stored' });
    const report = await engine.sync();
    expect(report.up.failed).toBe(1);
    expect(report.up.sent).toBe(1);
    const [failed] = await store.outbox.all();
    expect(failed?.status).toBe('failed');
    expect(failed?.lastError).toMatch(/Bad value/);
    expect(server.items.get('2')!.fields.Status).toBe('Stored');
  });

  it('stops and backs off on network errors, then succeeds later', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.failNext('update', offline());
    const report = await engine.sync();
    expect(report.up.interrupted).toBe(true);
    expect(report.down).toBeNull();
    const [entry] = await store.outbox.all();
    expect(entry?.status).toBe('pending');
    expect(entry?.nextAttemptAt).toBeGreaterThan(now);

    now = entry!.nextAttemptAt + 1;
    await engine.sync();
    expect(await store.outbox.all()).toEqual([]);
    expect(server.items.get('1')!.fields.Status).toBe('Completed');
  });

  it('honours Retry-After on 429', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.failNext('update', new GraphError(429, 'tooManyRequests', 'Slow down', 120_000));
    await engine.sync();
    const [entry] = await store.outbox.all();
    expect(entry?.nextAttemptAt).toBe(now + 120_000);
  });

  it('deletes with If-Match and drops a never-uploaded item locally without calling the server', async () => {
    await seed(1);
    await engine.sync();
    const temp = await engine.createItem({ Title: 'offline' });
    await engine.deleteItem(temp);
    expect(await store.outbox.all()).toEqual([]);

    const etag = server.etagOf('1');
    await engine.deleteItem('1');
    server.calls = [];
    await engine.sync();
    expect(server.calls.find((c) => c.startsWith('DELETE'))).toBe(`DELETE 1 ${etag}`);
    expect(server.items.has('1')).toBe(false);
  });
});

describe('temp-id remapping', () => {
  it('replaces the temporary id in items, queued edits and queued uploads', async () => {
    await engine.sync();
    const temp = await engine.createItem({ Title: '1234', Status: 'Active' });
    expect(isTempId(temp)).toBe(true);
    await engine.updateItem(temp, { Status: 'Stored' }); // merged into the create
    await store.uploads.add({
      itemLocalId: temp,
      docType: 'invoice',
      originalName: 'a.pdf',
      targetName: 'Invoice_a.pdf',
      localUri: 'file:///a.pdf',
      size: 10,
      mimeType: 'application/pdf',
      status: 'pending',
      now,
    });

    // Fail the first create so a separate update gets queued behind it.
    server.failNext('create', offline());
    await engine.sync();
    now += 10 * 60_000;
    await engine.updateItem(temp, { CustomerPO: 'LATE' });
    expect(await store.outbox.forItem(temp)).toHaveLength(2);

    now += 60 * 60_000;
    await engine.sync();
    const spId = [...server.items.keys()].pop()!;
    expect(server.items.get(spId)!.fields).toMatchObject({ Title: '1234', Status: 'Stored', CustomerPO: 'LATE' });
    expect(await store.items.get(temp)).toBeNull();
    const item = await store.items.get(spId);
    expect(item?.spId).toBe(spId);
    expect(item?.dirty).toBe(false);
    expect((await store.uploads.all())[0]!.itemLocalId).toBe(spId);
    expect(await store.outbox.all()).toEqual([]);
  });
});

describe('conflicts', () => {
  async function makeConflict() {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed', CustomerPO: 'MINE' });
    server.serverEdit('1', { Status: 'Cancelled', ProductName: 'Server product' });
    const report = await engine.sync();
    return report;
  }

  it('detects HTTP 412, stores the server version and never overwrites', async () => {
    const report = await makeConflict();
    expect(report.up.conflicts).toBe(1);
    const [entry] = await store.outbox.all();
    expect(entry?.status).toBe('conflict');
    expect(server.items.get('1')!.fields.Status).toBe('Cancelled');

    const view = await engine.getConflict(entry!.id);
    expect(view?.fields).toEqual([
      { key: 'Status', mine: 'Completed', server: 'Cancelled' },
      { key: 'CustomerPO', mine: 'MINE', server: 'PO-1' },
    ]);
    // Still blocked on the next sync until the user decides.
    await engine.sync();
    expect(server.items.get('1')!.fields.Status).toBe('Cancelled');
  });

  it('"keep mine" re-sends against the server eTag', async () => {
    await makeConflict();
    const [entry] = await store.outbox.all();
    await engine.resolveConflict(entry!.id, { mode: 'mine' });
    await engine.sync();
    expect(server.items.get('1')!.fields).toMatchObject({
      Status: 'Completed',
      CustomerPO: 'MINE',
      ProductName: 'Server product',
    });
    expect(await store.outbox.all()).toEqual([]);
  });

  it('"keep server" drops the local change and takes the server values', async () => {
    await makeConflict();
    const [entry] = await store.outbox.all();
    await engine.resolveConflict(entry!.id, { mode: 'server' });
    expect(await store.outbox.all()).toEqual([]);
    const local = await store.items.getBySpId('1');
    expect(local?.fields).toMatchObject({ Status: 'Cancelled', CustomerPO: 'PO-1' });
    expect(local?.dirty).toBe(false);
  });

  it('field-by-field merge keeps only the chosen local values', async () => {
    await makeConflict();
    const [entry] = await store.outbox.all();
    await engine.resolveConflict(entry!.id, { mode: 'merge', keepMine: ['CustomerPO'] });
    await engine.sync();
    expect(server.items.get('1')!.fields).toMatchObject({ Status: 'Cancelled', CustomerPO: 'MINE' });
  });

  it('"discard change" drops a rejected edit and restores the SharePoint version', async () => {
    await seed(1);
    await engine.sync();
    server.failNext('update', new GraphError(400, 'invalidRequest', 'Bad value'));
    await engine.updateItem('1', { Status: 'Bogus' });
    await engine.sync();
    const [entry] = await store.outbox.all();
    expect(entry?.status).toBe('failed');
    await engine.discardChange(entry!.id);
    expect(await store.outbox.all()).toEqual([]);
    const local = await store.items.getBySpId('1');
    expect(local?.fields.Status).toBe('Active');
    expect(local?.dirty).toBe(false);
  });

  it('treats an update to a PO deleted on the server as a conflict', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.serverDelete('1');
    await engine.sync();
    const [entry] = await store.outbox.all();
    expect(entry?.status).toBe('conflict');
    const view = await engine.getConflict(entry!.id);
    expect(view?.conflict.serverDeleted).toBe(true);

    // Keep mine = re-create it.
    await engine.resolveConflict(entry!.id, { mode: 'mine' });
    await engine.sync();
    const recreated = [...server.items.values()].find((i) => i.fields.Title === '901');
    expect(recreated?.fields.Status).toBe('Completed');
  });
});

describe('real SharePoint eTag behaviour', () => {
  beforeEach(() => {
    server.sharePointMode = true;
  });

  it('stores eTags quoted and sends a quoted If-Match, so an ordinary edit syncs', async () => {
    await seed(1);
    await engine.sync();
    expect((await store.items.getBySpId('1'))!.etag).toBe(server.etagOf('1')); // quoted
    await engine.updateItem('1', { Status: 'Completed' });
    server.calls = [];
    await engine.sync();
    expect(server.calls.find((c) => c.startsWith('PATCH'))).toBe('PATCH 1 "guid-1,1" {"Status":"Completed"}');
    expect(await store.outbox.all()).toEqual([]);
    expect(server.items.get('1')!.fields.Status).toBe('Completed');
  });

  it('repairs changes queued with an old unquoted eTag', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Stored' });
    const [entry] = await store.outbox.all();
    await store.outbox.retry(entry!.id, server.etagOf('1').replace(/"/g, ''));
    await engine.sync();
    expect(await store.outbox.all()).toEqual([]);
    expect(server.items.get('1')!.fields.Status).toBe('Stored');
  });

  it('turns 409 resourceModified into a conflict instead of a failed change', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.serverEdit('1', { Status: 'Cancelled' });
    await engine.sync();
    const [entry] = await store.outbox.all();
    expect(entry!.status).toBe('conflict');
  });
});

describe('version moved on, but not the fields being edited', () => {
  beforeEach(() => {
    server.sharePointMode = true;
  });

  it('re-sends the change on the new version when only other fields changed', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.serverEdit('1', { CustomerPO: 'PO-NEW' }); // e.g. a flow or another user, different column
    await engine.sync();
    expect(await store.outbox.all()).toEqual([]);
    expect(server.items.get('1')!.fields).toMatchObject({ Status: 'Completed', CustomerPO: 'PO-NEW' });
  });

  it('still asks the user when the same field was changed in SharePoint', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    server.serverEdit('1', { Status: 'Cancelled' });
    await engine.sync();
    expect((await store.outbox.all())[0]!.status).toBe('conflict');
    expect(server.items.get('1')!.fields.Status).toBe('Cancelled');
  });

  it('un-sticks an edit an older version marked "failed" with 409, and the edit queued behind it', async () => {
    await seed(1);
    await engine.sync();
    await engine.updateItem('1', { Status: 'Completed' });
    const [first] = await store.outbox.all();
    await store.outbox.markFailed(first!.id, '409 resourceModified: The resource has changed since the caller last read it', 0);
    await engine.updateItem('1', { Remarks: 'Order completed' }); // second entry, pending behind the failed one
    expect((await store.outbox.all()).map((e) => e.status)).toEqual(['failed', 'pending']);
    await engine.sync();
    expect(await store.outbox.all()).toEqual([]);
    expect(server.items.get('1')!.fields).toMatchObject({ Status: 'Completed', Remarks: 'Order completed' });
  });
});
