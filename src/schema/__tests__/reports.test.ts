import type { LocalItem } from '../../db/repositories/items';
import { builtInReports, groupReport, reportCsv, runReport, UNASSIGNED, type Report } from '../../reports/reports';
import { describeConditions, matchesConditions, type ConditionSet } from '../conditions';
import { SAMPLE_COLUMNS } from '../../testing/fakeList';
import { buildSchema } from '../columnMapper';

const schema = buildSchema([
  ...SAMPLE_COLUMNS,
  { name: 'AWB', displayName: 'AWB', text: {} },
  { name: 'Trackingno_x002e_', displayName: 'AWB#', text: {} },
]);
const ctx = { timeZone: 'America/Los_Angeles', people: { '7': 'Pat Shah', '9': 'Ved Nasit' } as Record<string, string> };

const item = (localId: string, fields: LocalItem['fields']): LocalItem => ({
  localId,
  spId: localId,
  fields,
  etag: null,
  modifiedAt: null,
  modifiedBy: null,
  createdAt: null,
  dirty: false,
});

describe('reports', () => {
  const items = [
    item('a', { Title: '900', _x0077_tp0: 2, Status: 'Completed', ProductName: 'X, "big"' }),
    item('b', { Title: '900', _x0077_tp0: 1, Status: 'Completed', Trackingno_x002e_: '' }),
    item('c', { Title: '950', _x0077_tp0: 1, Status: 'Completed', Trackingno_x002e_: '7788' }),
    item('d', { Title: '951', _x0077_tp0: 1, Status: 'Active' }),
  ];

  it('resolves built-in reports against the schema and labels the two AWB columns apart', () => {
    const reports = builtInReports(schema);
    const awb = reports.find((r) => r.id === 'completed-no-awb')!;
    expect(awb.conditions.conditions.map((c) => [c.field, c.op])).toEqual([
      ['Status', 'eq'],
      ['Trackingno_x002e_', 'empty'],
    ]);
    expect(schema.byName.AWB!.label).toBe('Inbound AWB #');
    expect(schema.byName.Trackingno_x002e_!.label).toBe('Outbound AWB #');
    // Needs a JRS invoice column, which the sample list doesn't have.
    expect(reports.find((r) => r.id === 'completed-no-invoice')).toBeUndefined();
  });

  it('finds Completed lines with no outbound AWB, newest folder first, then by line', () => {
    const awb = builtInReports(schema).find((r) => r.id === 'completed-no-awb')!;
    expect(runReport(items, awb, schema, ctx).map((i) => i.localId)).toEqual(['b', 'a']);
  });

  it('returns nothing for a report with no complete conditions', () => {
    const empty: Report = { id: 'x', name: 'x', conditions: { match: 'all', conditions: [] }, columns: [] };
    expect(runReport(items, empty, schema, ctx)).toEqual([]);
  });

  it('exports CSV with identity columns, report columns and escaping', () => {
    const awb = builtInReports(schema).find((r) => r.id === 'completed-no-awb')!;
    const csv = reportCsv([items[0]!], awb, schema, ctx).split('\r\n');
    expect(csv[0]).toBe('Folder #,Line #,Customer Name,Product Name,Status,Outbound AWB #,Dispatch carrier,Dispatch Date');
    expect(csv[1]).toBe('900,2,,"X, ""big""",Completed,,,');
  });

  it('daily meeting: Active or Ready to Ship, grouped by account manager A-Z, unassigned last', () => {
    const meet = builtInReports(schema).find((r) => r.id === 'daily-meeting')!;
    expect(meet.groupBy).toBe('AccountManager');
    const rows = runReport(
      [
        item('1', { Title: '10', Status: 'Active', AccountManagerLookupId: '9' }),
        item('2', { Title: '11', Status: 'Ready to Ship', AccountManagerLookupId: '7' }),
        item('3', { Title: '12', Status: 'Completed', AccountManagerLookupId: '7' }),
        item('4', { Title: '13', Status: 'Active' }),
        item('5', { Title: '14', Status: 'Active', AccountManagerLookupId: '7' }),
      ],
      meet,
      schema,
      ctx,
    );
    const groups = groupReport(rows, meet, schema, ctx);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.localId)])).toEqual([
      ['Pat Shah', ['5', '2']],
      ['Ved Nasit', ['1']],
      [UNASSIGNED, ['4']],
    ]);
    expect(groups[0]!.statusCounts).toEqual([
      ['Active', 1],
      ['Ready to Ship', 1],
    ]);
  });
});

describe('AND / OR between conditions', () => {
  // (Status Active OR Status Ready to Ship) AND outbound AWB empty
  const set: ConditionSet = {
    match: 'all',
    conditions: [
      { id: '1', field: 'Status', op: 'eq', value: 'Active' },
      { id: '2', field: 'Status', op: 'eq', value: 'Ready to Ship', join: 'or' },
      { id: '3', field: 'Trackingno_x002e_', op: 'empty', value: '', join: 'and' },
    ],
  };
  it('treats OR-joined conditions as one bracket', () => {
    expect(matchesConditions({ Status: 'Active' }, set, schema, ctx)).toBe(true);
    expect(matchesConditions({ Status: 'Ready to Ship' }, set, schema, ctx)).toBe(true);
    expect(matchesConditions({ Status: 'Ready to Ship', Trackingno_x002e_: 'X1' }, set, schema, ctx)).toBe(false);
    expect(matchesConditions({ Status: 'Completed' }, set, schema, ctx)).toBe(false);
  });
  it('describes the brackets', () => {
    expect(describeConditions(set, schema, ctx)).toBe('(Status is “Active”  OR  Status is “Ready to Ship”)  AND  Outbound AWB # is empty');
  });
  it('falls back to match all / any for older saved filters', () => {
    const any: ConditionSet = { match: 'any', conditions: set.conditions.map(({ join: _j, ...c }) => c) };
    expect(matchesConditions({ Status: 'Completed' }, any, schema, ctx)).toBe(true); // AWB empty
  });
});
