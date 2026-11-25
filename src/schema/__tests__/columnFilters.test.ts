import type { LocalItem } from '../../db/repositories/items';
import { SAMPLE_COLUMNS } from '../../testing/fakeList';
import { buildSchema } from '../columnMapper';
import { applyColumnFilters, distinctValues, sortByColumn } from '../columnFilters';

const schema = buildSchema(SAMPLE_COLUMNS);
const ctx = { timeZone: 'America/Los_Angeles', people: { '7': 'Pat Shah', '9': 'Ved Nasit' } };
const row = (id: string, fields: LocalItem['fields']): LocalItem => ({
  localId: id,
  spId: id,
  fields,
  etag: null,
  modifiedAt: null,
  modifiedBy: null,
  createdAt: null,
  dirty: false,
});

const items = [
  row('a', { Status: 'Active', _x0077_tp0: 10, AccountManagerLookupId: '7', ReceivedDate: '2026-11-20T08:00:00Z' }),
  row('b', { Status: 'Completed', _x0077_tp0: 2, AccountManagerLookupId: '9' }),
  row('c', { Status: 'Active', _x0077_tp0: 1, ReceivedDate: '2026-01-05T08:00:00Z' }),
  row('d', { _x0077_tp0: null, AccountManagerLookupId: '9' }),
];

describe('column filters', () => {
  it('keeps rows whose display value is selected, including blanks and person names', () => {
    expect(applyColumnFilters(items, { Status: ['Active'] }, schema, ctx).map((i) => i.localId)).toEqual(['a', 'c']);
    expect(applyColumnFilters(items, { Status: [''] }, schema, ctx).map((i) => i.localId)).toEqual(['d']);
    expect(applyColumnFilters(items, { AccountManager: ['Ved Nasit'], Status: ['Completed'] }, schema, ctx).map((i) => i.localId)).toEqual(['b']);
    expect(applyColumnFilters(items, { Status: ['Active'] }, schema, ctx, 'Status')).toHaveLength(4);
  });

  it('lists distinct values with counts, blank first, numbers in numeric order', () => {
    expect(distinctValues(items, schema.byName.Status!, ctx)).toEqual([
      { value: '', count: 1 },
      { value: 'Active', count: 2 },
      { value: 'Completed', count: 1 },
    ]);
    expect(distinctValues(items, schema.byName._x0077_tp0!, ctx).map((v) => v.value)).toEqual(['', '1', '2', '10']);
  });

  it('sorts by any column (numbers, dates, text), blanks last', () => {
    expect(sortByColumn(items, { field: '_x0077_tp0', dir: 'asc' }, schema, ctx).map((i) => i.localId)).toEqual(['c', 'b', 'a', 'd']);
    expect(sortByColumn(items, { field: '_x0077_tp0', dir: 'desc' }, schema, ctx).map((i) => i.localId)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortByColumn(items, { field: 'ReceivedDate', dir: 'asc' }, schema, ctx).map((i) => i.localId)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortByColumn(items, { field: 'AccountManager', dir: 'asc' }, schema, ctx).map((i) => i.localId)).toEqual(['a', 'b', 'd', 'c']);
  });
});
