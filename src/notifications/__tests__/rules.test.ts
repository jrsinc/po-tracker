import type { LocalItem } from '../../db/repositories/items';
import { buildSchema } from '../../schema/columnMapper';
import { SAMPLE_COLUMNS } from '../../testing/fakeList';
import type { ChangeEvent } from '../../sync/types';
import {
  DEFAULT_PREFS,
  evaluateChanges,
  evaluateDaily,
  evaluateSyncProblems,
  myLookupIds,
  type RuleContext,
} from '../rules';

const rc: RuleContext = {
  schema: buildSchema(SAMPLE_COLUMNS),
  timeZone: 'America/Los_Angeles',
  people: { '7': 'Pat Shah', '9': 'Ved Nasit' },
  myLookupIds: ['7'],
  myDisplayName: 'Pat Shah',
};

const change = (over: Partial<ChangeEvent>): ChangeEvent => ({
  kind: 'updated',
  localId: '1',
  spId: '1',
  before: { Title: '923', Status: 'Active', Customer: 'BM Clinical' },
  after: { Title: '923', Status: 'Completed', Customer: 'BM Clinical' },
  modifiedBy: 'Ved Nasit',
  ...over,
});

describe('evaluateChanges', () => {
  it('alerts on status changes made by others', () => {
    const [n] = evaluateChanges([change({})], DEFAULT_PREFS, rc);
    expect(n?.title).toBe('Status: Completed');
    expect(n?.body).toBe('PO 923 · BM Clinical changed from Active to Completed by Ved Nasit');
  });

  it('ignores my own changes and respects the status filter', () => {
    expect(evaluateChanges([change({ modifiedBy: 'Pat Shah' })], DEFAULT_PREFS, rc)).toEqual([]);
    expect(evaluateChanges([change({})], { ...DEFAULT_PREFS, statusFilter: ['Ready to Ship'] }, rc)).toEqual([]);
  });

  it('alerts when a PO is assigned to me, and limits to my POs when asked', () => {
    const assigned = change({ after: { Title: '923', Status: 'Active', AccountManagerLookupId: '7' } });
    expect(evaluateChanges([assigned], DEFAULT_PREFS, rc)[0]?.title).toBe('PO assigned to you');
    expect(evaluateChanges([change({})], { ...DEFAULT_PREFS, onlyMine: true }, rc)).toEqual([]);
  });

  it('alerts on new POs', () => {
    const created = change({ kind: 'created', before: null });
    expect(evaluateChanges([created], DEFAULT_PREFS, rc)[0]?.title).toBe('New PO');
    expect(evaluateChanges([created], { ...DEFAULT_PREFS, newPo: false }, rc)).toEqual([]);
  });
});

describe('evaluateDaily', () => {
  const item = (fields: LocalItem['fields']): LocalItem => ({
    localId: 'x',
    spId: 'x',
    fields: { Title: '100', Status: 'Active', ...fields },
    etag: null,
    modifiedAt: null,
    modifiedBy: null,
    createdAt: null,
    dirty: false,
  });

  it('warns about products expiring soon (free-text expiry formats)', () => {
    const notes = evaluateDaily([item({ ExpiryDate: 'Dec-26' })], DEFAULT_PREFS, rc, '2026-11-24');
    expect(notes.map((n) => n.title)).toEqual(['Product expires in 37 days']);
    expect(evaluateDaily([item({ ExpiryDate: '12/2027' })], DEFAULT_PREFS, rc, '2026-11-24')).toEqual([]);
  });

  it('warns when received but not dispatched for too long, unless closed', () => {
    const waiting = item({ ReceivedDate: '2026-11-10T08:00:00Z' });
    expect(evaluateDaily([waiting], DEFAULT_PREFS, rc, '2026-11-24')[0]?.title).toBe('Waiting to ship for 14 days');
    expect(evaluateDaily([{ ...waiting, fields: { ...waiting.fields, Status: 'Completed' } }], DEFAULT_PREFS, rc, '2026-11-24')).toEqual([]);
    expect(evaluateDaily([{ ...waiting, fields: { ...waiting.fields, DispatchDate: '2026-11-12T08:00:00Z' } }], DEFAULT_PREFS, rc, '2026-11-24')).toEqual([]);
  });
});

describe('helpers', () => {
  it('reports sync problems', () => {
    const n = evaluateSyncProblems({ conflicts: 2, failedChanges: 1, failedUploads: 0 }, DEFAULT_PREFS, '2026-11-24');
    expect(n.map((x) => x.title)).toEqual(['Sync conflict needs your decision', 'Some items could not sync']);
  });

  it('matches me in the site user list by email or claims login', () => {
    const people = [
      { lookupId: '7', email: 'pat@example.com' },
      { lookupId: '8', email: 'i:0#.f|membership|PAT@example.com' },
      { lookupId: '9', email: 'ved@example.com' },
    ];
    expect(myLookupIds(people, ['pat@example.com'])).toEqual(['7', '8']);
  });
});
