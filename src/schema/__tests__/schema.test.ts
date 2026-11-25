import { parseConfig, ConfigError } from '../../config/env';
import { SAMPLE_COLUMNS } from '../../testing/fakeList';
import { buildSchema } from '../columnMapper';
import { daysBetween, isoToYmd, parseExpiry, ymdToIso } from '../dates';
import { diffToGraph, displayValue, formFromFields, validateForm } from '../values';

const TZ = 'America/Los_Angeles';

describe('buildSchema', () => {
  const schema = buildSchema(SAMPLE_COLUMNS);

  it('maps display names to groups without hard-coded internal names', () => {
    expect(schema.bySemantic.folder?.name).toBe('Title');
    expect(schema.bySemantic.folder?.label).toBe('Folder #');
    expect(schema.bySemantic.status?.name).toBe('Status');
    expect(schema.bySemantic.customer?.name).toBe('Customer');
    expect(schema.byName['_x0077_tp0']?.groupKey).toBe('order');
    expect(schema.byName.Carrier?.groupKey).toBe('receiving');
    expect(schema.byName.Carrierthrough?.groupKey).toBe('dispatch');
  });

  it('keeps both columns that share a display name, labelled distinctly', () => {
    const psc = schema.fields.filter((f) => f.displayName === 'Product Source Country');
    expect(psc.map((f) => f.name)).toEqual(['ProductSourceCountry', 'ProductSourceCountry0']);
    expect(psc.map((f) => f.label)).toEqual(['Product Source Country', 'Product Source Country (2)']);
    expect(new Set(psc.map((f) => f.groupKey))).toEqual(new Set(['product']));
  });

  it('puts unknown columns in Other and skips hidden/system/read-only columns', () => {
    const other = schema.groups.find((g) => g.key === 'other');
    expect(other?.fields.map((f) => f.name)).toEqual(['NewColumn']);
    for (const n of ['ID', 'Modified', 'ContentType', 'Attachments', '_UIVersionString', 'HiddenThing']) {
      expect(schema.byName[n]).toBeUndefined();
    }
  });

  it('shows calculated columns read-only and person columns via LookupId', () => {
    expect(schema.byName['Ready_x0020_To_x0020_Ship_x002d_']).toMatchObject({ kind: 'calculated', readOnly: true });
    expect(schema.byName.AccountManager).toMatchObject({ kind: 'person', readOnly: false });
  });
});

describe('values', () => {
  const schema = buildSchema(SAMPLE_COLUMNS);
  const ctx = { timeZone: TZ, people: { '7': 'Pat Shah' } };

  it('formats person, boolean and date-only values', () => {
    const fields = { AccountManagerLookupId: '7', EPCISDataRequired: true, ReceivedDate: '2026-11-20T08:00:00Z' };
    expect(displayValue(fields, schema.byName.AccountManager!, ctx)).toBe('Pat Shah');
    expect(displayValue(fields, schema.byName.EPCISDataRequired!, ctx)).toBe('Yes');
    expect(displayValue(fields, schema.byName.ReceivedDate!, ctx)).toBe('20 Nov 2026');
  });

  it('produces a minimal Graph patch with site-midnight dates and LookupId keys', () => {
    const before = formFromFields({ Status: 'Active', ReceivedDate: '2026-11-20T08:00:00Z' }, schema, ctx);
    const after = { ...before, Status: 'Completed', ReceivedDate: '2026-07-04', AccountManager: '7' };
    expect(diffToGraph(before, after, schema, ctx)).toEqual({
      Status: 'Completed',
      ReceivedDate: '2026-07-04T07:00:00Z',
      AccountManagerLookupId: '7',
    });
  });

  it('validates numbers, dates and choices', () => {
    const errors = validateForm({ _x0077_tp0: 'abc', ReceivedDate: '2026-02-30', Status: 'Nope' }, schema);
    expect(Object.keys(errors).sort()).toEqual(['ReceivedDate', 'Status', '_x0077_tp0']);
  });
});

describe('dates', () => {
  it('round-trips date-only values through the site time zone across DST', () => {
    expect(ymdToIso('2026-01-15', TZ)).toBe('2026-01-15T08:00:00Z');
    expect(ymdToIso('2026-07-15', TZ)).toBe('2026-07-15T07:00:00Z');
    expect(isoToYmd('2026-11-11T08:00:00Z', TZ)).toBe('2026-11-11');
    expect(isoToYmd('2026-10-30T07:00:00Z', TZ)).toBe('2026-10-30');
  });

  it('parses the free-text expiry formats used in the list', () => {
    expect(parseExpiry('12/2026')).toBe('2026-12-31');
    expect(parseExpiry('04/2029')).toBe('2029-04-30');
    expect(parseExpiry('Sep-27')).toBe('2027-09-30');
    expect(parseExpiry('Apr-29')).toBe('2029-04-30');
    expect(parseExpiry('31 JAN 2027')).toBe('2027-01-31');
    expect(parseExpiry('2027-01-31')).toBe('2027-01-31');
    expect(parseExpiry('1/31/2027')).toBe('2027-01-31');
    expect(parseExpiry('Feb 2028')).toBe('2028-02-29');
    expect(parseExpiry('NA')).toBeNull();
    expect(parseExpiry('')).toBeNull();
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-20', '2026-11-24')).toBe(4);
  });
});

describe('config', () => {
  const base = {
    EXPO_PUBLIC_TENANT_ID: 'e98f8ec2-bb19-4dfc-a89a-e07adee53b2a',
    EXPO_PUBLIC_CLIENT_ID: '11111111-2222-3333-4444-555555555555',
    EXPO_PUBLIC_SP_HOST: 'https://jrsllc1.sharepoint.com/',
    EXPO_PUBLIC_SP_SITE_PATH: 'sites/jrsllc/',
    EXPO_PUBLIC_SP_LIST_NAME: 'PO Tracking 2026 JRS INC',
    EXPO_PUBLIC_SP_LIBRARY_NAME: 'PO Documents 2026',
  };

  it('normalises host and paths', () => {
    const c = parseConfig({ ...base, EXPO_PUBLIC_SP_BASE_FOLDER: '/2026/' });
    expect(c.siteHost).toBe('jrsllc1.sharepoint.com');
    expect(c.sitePath).toBe('/sites/jrsllc');
    expect(c.baseFolder).toBe('2026');
    expect(c.scopes).toContain('offline_access');
  });

  it('reports missing values and placeholder client ids', () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    expect(() => parseConfig({ ...base, EXPO_PUBLIC_CLIENT_ID: '00000000-0000-0000-0000-000000000000' })).toThrow(/CLIENT_ID/);
  });
});
