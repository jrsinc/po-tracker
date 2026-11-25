import type { LocalStore } from '../../db/store';
import { CHUNK_SIZE } from '../../graph/drive';
import { GraphError, NetworkError } from '../../graph/http';
import { createTestStore } from '../../testing/nodeDriver';
import { FakeDrive, FakeFiles } from '../../testing/fakeDrive';
import { buildTargetName, poFolderPath, sanitizeName } from '../paths';
import { FolderMissingError, UploadEngine } from '../UploadEngine';

let store: LocalStore;
let drive: FakeDrive;
let files: FakeFiles;
let engine: UploadEngine;
let now: number;

async function addItem(localId: string, folder: string | null) {
  await store.items.upsert(
    {
      localId,
      spId: localId.startsWith('tmp_') ? null : localId,
      fields: folder === null ? {} : { Title: folder },
      etag: null,
      modifiedAt: null,
      modifiedBy: null,
      createdAt: null,
      dirty: false,
    },
    '',
  );
}

beforeEach(async () => {
  store = await createTestStore();
  drive = new FakeDrive();
  files = new FakeFiles();
  now = Date.parse('2026-11-24T12:00:00Z');
  engine = new UploadEngine({
    store,
    drive: async () => drive,
    files,
    baseFolder: 'PO Folders',
    folderValue: async (item) => (typeof item.fields.Title === 'string' ? item.fields.Title : null),
    now: () => now,
    random: () => 0.5,
  });
});

describe('paths', () => {
  it('sanitises names for SharePoint', () => {
    expect(sanitizeName('inv:12*3?.pdf')).toBe('inv_12_3_.pdf');
    expect(sanitizeName('  report.  ')).toBe('report');
    expect(sanitizeName('CON')).toBe('_CON');
    expect(sanitizeName('a/b\\c|d"e<f>g.pdf')).toBe('a_b_c_d_e_f_g.pdf');
    expect(sanitizeName('x'.repeat(300) + '.pdf').length).toBe(200);
  });

  it('builds "{prefix}_{name}" and the per-PO folder path', () => {
    expect(buildTargetName('invoice', 'scan 1.pdf')).toBe('Invoice_scan 1.pdf');
    expect(buildTargetName('packing_slip', 'a?.jpg')).toBe('PackingSlip_a_.jpg');
    expect(poFolderPath('', '923')).toBe('923');
    expect(poFolderPath('PO Folders/2026', '12/A')).toBe('PO Folders/2026/12_A');
  });
});

describe('UploadEngine', () => {
  it('blocks upload for a PO without a FOLDER # value', async () => {
    await addItem('5', null);
    await expect(engine.enqueue('5', 'invoice', { uri: 'x', name: 'a.pdf', size: 10 })).rejects.toBeInstanceOf(FolderMissingError);
    expect(await store.uploads.all()).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('queues offline as "pending", then uploads when connectivity returns', async () => {
    await addItem('5', '923');
    const id = await engine.enqueue('5', 'invoice', { uri: 'content://a', name: 'a.pdf', size: 1000, mimeType: 'application/pdf' });
    expect((await store.uploads.get(id))?.status).toBe('pending');
    expect(files.files.size).toBe(1); // copied into app storage

    drive.failures.push({ op: 'uploadSmall', error: new NetworkError('offline') });
    const offlineRun = await engine.process();
    expect(offlineRun.interrupted).toBe(true);
    const queued = await store.uploads.get(id);
    expect(queued?.status).toBe('pending');
    expect(queued?.nextAttemptAt).toBeGreaterThan(now);

    now = queued!.nextAttemptAt + 1;
    const run = await engine.process();
    expect(run.uploaded).toBe(1);
    expect(drive.files.has('PO Folders/923/Invoice_a.pdf')).toBe(true);
    expect((await store.uploads.get(id))?.status).toBe('done');
    expect(files.files.size).toBe(0); // local copy removed after upload
    expect((await store.docs.forFolder('PO Folders/923')).map((d) => d.name)).toEqual(['Invoice_a.pdf']);
  });

  it('creates the PO folder (and the base folder) before the first upload, once', async () => {
    await addItem('5', '923');
    await engine.enqueue('5', 'awb', { uri: 'u', name: 'a.pdf', size: 10 });
    await engine.enqueue('5', 'awb', { uri: 'u', name: 'b.pdf', size: 10 });
    await engine.process();
    expect(drive.calls.filter((c) => c.startsWith('MKDIR'))).toEqual(['MKDIR |PO Folders', 'MKDIR PO Folders|923']);
    expect(drive.folders.has('PO Folders/923')).toBe(true);
  });

  it('never overwrites: a second file with the same name is renamed', async () => {
    await addItem('5', '923');
    await engine.enqueue('5', 'invoice', { uri: 'u', name: 'a.pdf', size: 10 });
    await engine.enqueue('5', 'invoice', { uri: 'u', name: 'a.pdf', size: 10 });
    await engine.process();
    expect([...drive.files.keys()].sort()).toEqual(['PO Folders/923/Invoice_a 1.pdf', 'PO Folders/923/Invoice_a.pdf']);
  });

  it('uploads large files in 320 KiB-multiple chunks', async () => {
    await addItem('5', '923');
    const size = CHUNK_SIZE * 2 + 12345;
    await engine.enqueue('5', 'customer_po', { uri: 'u', name: 'big.pdf', size });
    const run = await engine.process();
    expect(run.uploaded).toBe(1);
    expect(drive.calls.filter((c) => c.startsWith('CHUNK'))).toHaveLength(3);
    const stored = drive.files.get('PO Folders/923/CustomerPO_big.pdf')!;
    expect(stored.length).toBe(size);
    expect(stored[size - 1]).toBe((size - 1) % 251);
  });

  it('resumes a chunked upload after an interruption from where the session left off', async () => {
    await addItem('5', '923');
    const size = CHUNK_SIZE * 3 + 100;
    const id = await engine.enqueue('5', 'invoice', { uri: 'u', name: 'big.pdf', size });
    drive.failures.push({ op: 'uploadChunk', error: new NetworkError('connection lost'), afterChunks: 2 });

    const first = await engine.process();
    expect(first.interrupted).toBe(true);
    const mid = await store.uploads.get(id);
    expect(mid?.bytesSent).toBe(CHUNK_SIZE * 2);
    expect(mid?.sessionUrl).toBeTruthy();

    // Simulate an app restart mid-upload: the row is left "uploading".
    await store.uploads.setStatus(id, 'uploading');
    now = mid!.nextAttemptAt + 1;
    drive.calls = [];
    const second = await engine.process();
    expect(second.uploaded).toBe(1);
    expect(drive.calls[0]).toMatch(/^STATUS /); // asked the session where to continue
    expect(drive.calls.filter((c) => c.startsWith('SESSION'))).toHaveLength(0); // no new session
    expect(drive.calls.filter((c) => c.startsWith('CHUNK'))).toEqual([
      `CHUNK ${mid!.sessionUrl} ${CHUNK_SIZE * 2}+${CHUNK_SIZE}/${size}`,
      `CHUNK ${mid!.sessionUrl} ${CHUNK_SIZE * 3}+100/${size}`,
    ]);
    expect(drive.files.get('PO Folders/923/Invoice_big.pdf')?.length).toBe(size);
  });

  it('starts a new session when the old one has expired', async () => {
    await addItem('5', '923');
    const size = CHUNK_SIZE * 2 + 1;
    const id = await engine.enqueue('5', 'invoice', { uri: 'u', name: 'big.pdf', size });
    drive.failures.push({ op: 'uploadChunk', error: new NetworkError('lost'), afterChunks: 1 });
    await engine.process();
    const mid = await store.uploads.get(id);
    drive.sessions.get(mid!.sessionUrl!)!.expired = true;

    now = mid!.nextAttemptAt + 1;
    await engine.process();
    expect(drive.calls.filter((c) => c.startsWith('SESSION'))).toHaveLength(2);
    expect((await store.uploads.get(id))?.status).toBe('done');
  });

  it('marks non-retryable errors failed and allows a manual retry', async () => {
    await addItem('5', '923');
    const id = await engine.enqueue('5', 'invoice', { uri: 'u', name: 'a.pdf', size: 10 });
    drive.failures.push({ op: 'uploadSmall', error: new GraphError(403, 'accessDenied', 'No permission') });
    const run = await engine.process();
    expect(run.failed).toBe(1);
    expect((await store.uploads.get(id))?.lastError).toMatch(/No permission/);

    await engine.retry(id);
    await engine.process();
    expect((await store.uploads.get(id))?.status).toBe('done');
  });

  it('uploads documents queued for an offline-created PO (after its id is remapped)', async () => {
    await addItem('tmp_abc', '1001');
    const id = await engine.enqueue('tmp_abc', 'vendor_po', { uri: 'u', name: 'v.pdf', size: 10 });
    await store.transaction(async () => {
      await store.items.remapId('tmp_abc', '42', '42');
      await store.uploads.remapItem('tmp_abc', '42');
    });
    await engine.process();
    const u = await store.uploads.get(id);
    expect(u?.itemLocalId).toBe('42');
    expect(u?.status).toBe('done');
    expect(drive.files.has('PO Folders/1001/VendorPO_v.pdf')).toBe(true);
  });

  it('blocks a queued upload whose PO lost its FOLDER #, and unblocks once it is set', async () => {
    await addItem('5', '923');
    const id = await engine.enqueue('5', 'invoice', { uri: 'u', name: 'a.pdf', size: 10 });
    await addItem('5', null);
    await engine.process();
    expect((await store.uploads.get(id))?.status).toBe('blocked');
    await addItem('5', '924');
    await engine.process();
    expect((await store.uploads.get(id))?.status).toBe('done');
    expect(drive.files.has('PO Folders/924/Invoice_a.pdf')).toBe(true);
  });
});
