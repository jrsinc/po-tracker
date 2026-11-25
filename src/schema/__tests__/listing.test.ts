import type { LocalItem } from '../../db/repositories/items';
import { SAMPLE_COLUMNS } from '../../testing/fakeList';
import { buildSchema } from '../columnMapper';
import { describeCondition, matchesConditions, opsFor, type Condition, type ConditionSet } from '../conditions';
import { groupByFolder } from '../grouping';

const schema = buildSchema(SAMPLE_COLUMNS);
const ctx = { timeZone: 'America/Los_Angeles', people: { '7': 'Pat Shah', '9': 'Ved Nasit' } };

const item = (localId: string, fields: LocalItem['fields'], dirty = false): LocalItem => ({
  localId,
  spId: localId,
  fields,
  etag: null,
  modifiedAt: null,
  modifiedBy: null,
  createdAt: null,
  dirty,
});

let n = 0;
const cond = (field: string, op: Condition['op'], value = ''): Condition => ({ id: String(++n), field, op, value });
const all = (...conditions: Condition[]): ConditionSet => ({ match: 'all', conditions });

describe('conditions', () => {
  const f = {
    Title: '922',
    Status: 'Ready to Ship',
    ProductName: 'EYLEA 2mg/0.05ml PFS',
    _x0077_tp0: 3,
    ReceivedDate: '2026-11-20T08:00:00Z',
    AccountManagerLookupId: '9',
    EPCISDataRequired: true,
  };

  it('matches text, choice, number, date, person and boolean conditions', () => {
    expect(matchesConditions(f, all(cond('ProductName', 'contains', 'eylea')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('ProductName', 'notContains', 'eylea')), schema, ctx)).toBe(false);
    expect(matchesConditions(f, all(cond('Status', 'eq', 'ready to ship')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('Status', 'neq', 'Completed')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('_x0077_tp0', 'gt', '2')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('_x0077_tp0', 'lte', '2')), schema, ctx)).toBe(false);
    expect(matchesConditions(f, all(cond('ReceivedDate', 'on', '2026-11-20')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('ReceivedDate', 'after', '2026-11-01')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('ReceivedDate', 'before', '2026-11-20')), schema, ctx)).toBe(false);
    expect(matchesConditions(f, all(cond('AccountManager', 'eq', '9')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('AccountManager', 'contains', 'ved')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('EPCISDataRequired', 'isTrue')), schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('DispatchDate', 'empty')), schema, ctx)).toBe(true);
  });

  it('combines with all / any and ignores incomplete conditions', () => {
    const a = cond('Status', 'eq', 'Completed');
    const b = cond('ProductName', 'contains', 'eylea');
    expect(matchesConditions(f, { match: 'all', conditions: [a, b] }, schema, ctx)).toBe(false);
    expect(matchesConditions(f, { match: 'any', conditions: [a, b] }, schema, ctx)).toBe(true);
    expect(matchesConditions(f, all(cond('Status', 'eq', '')), schema, ctx)).toBe(true);
  });

  it('offers operators by column type and describes conditions', () => {
    expect(opsFor('date').map((o) => o.op)).toEqual(['on', 'before', 'after', 'empty', 'notEmpty']);
    expect(opsFor('boolean').every((o) => !o.needsValue)).toBe(true);
    expect(describeCondition(cond('ReceivedDate', 'after', '2026-11-01'), schema, ctx)).toBe('Received Date is after “1 Nov 2026”');
    expect(describeCondition(cond('AccountManager', 'eq', '9'), schema, ctx)).toBe('Account Manager is “Ved Nasit”');
  });
});

describe('groupByFolder', () => {
  it('puts every line of a Folder # in one group, lines ordered by Line #', () => {
    const items = [
      item('a', { Title: '717', _x0077_tp0: 3, Customer: 'BM Clinical', ProductName: 'P3', Status: 'Active' }),
      item('b', { Title: '922', _x0077_tp0: 1, Customer: 'Rigen Pharma', ProductName: 'Q1', Status: 'Completed' }),
      item('c', { Title: '717', _x0077_tp0: 1, Customer: 'BM Clinical', ProductName: 'P1', Status: 'Ready to Ship' }, true),
      item('d', { _x0077_tp0: 1, ProductName: 'no folder' }),
    ];
    const groups = groupByFolder(items, schema, ctx);
    expect(groups.map((g) => g.folder)).toEqual(['717', '922', '']);
    expect(groups[0]!.lines.map((l) => l.localId)).toEqual(['c', 'a']);
    expect(groups[0]!.customer).toBe('BM Clinical');
    expect(groups[0]!.statuses).toEqual(['Ready to Ship', 'Active']);
    expect(groups[0]!.dirty).toBe(true);

    expect(groupByFolder(items, schema, ctx, true).map((g) => g.folder)).toEqual(['922', '717', '']);
  });
});
