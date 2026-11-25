import type { SemanticKey } from '../config/schemaGroups';
import type { LocalItem } from '../db/repositories/items';
import type { Schema } from '../schema/columnMapper';
import { isComplete, matchesConditions, type Condition, type ConditionSet, type Op } from '../schema/conditions';
import { displayValue, type ValueContext } from '../schema/values';

/**
 * Data-quality / follow-up reports: "lines matching these conditions", with the columns to
 * show and fill in. Built-in reports are defined by semantic keys (resolved against the live
 * schema); custom reports are saved on this device.
 */
export interface Report {
  id: string;
  name: string;
  description?: string;
  conditions: ConditionSet;
  /** Columns to show and edit for each matching line (internal names, in order). */
  columns: string[];
  /** Optional column to group lines by (e.g. Account Manager), internal name. */
  groupBy?: string;
  builtIn?: boolean;
}

export interface ReportGroup {
  key: string;
  title: string;
  rows: LocalItem[];
  /** Status value -> number of lines, in first-seen order. */
  statusCounts: [string, number][];
}

export const REPORTS_KEY = 'reports.custom';

/** Columns always shown at the top of each report row (not editable there). */
export const IDENTITY_KEYS: SemanticKey[] = ['folder', 'line', 'customer', 'product', 'status'];

interface Preset {
  id: string;
  name: string;
  description: string;
  match?: 'all' | 'any';
  when: [SemanticKey, Op, string?][];
  columns: SemanticKey[];
  groupBy?: SemanticKey;
}

const PRESETS: Preset[] = [
  {
    id: 'daily-meeting',
    name: 'Daily meeting: open lines by account manager',
    description: 'Every line with Status Active or Ready to Ship, grouped by account manager. Update remarks during the meeting.',
    match: 'any',
    when: [
      ['status', 'eq', 'Active'],
      ['status', 'eq', 'Ready to Ship'],
    ],
    columns: ['status', 'remarksOnStatus', 'remarks'],
    groupBy: 'accountManager',
  },
  {
    id: 'completed-no-awb',
    name: 'Completed, outbound AWB missing',
    description: 'Status is Completed but there is no outbound AWB / tracking number.',
    when: [
      ['status', 'eq', 'Completed'],
      ['awbOut', 'empty'],
    ],
    columns: ['awbOut', 'dispatchCarrier', 'dispatchDate'],
  },
  {
    id: 'completed-no-dispatch-date',
    name: 'Completed, dispatch date missing',
    description: 'Status is Completed but the dispatch date is empty.',
    when: [
      ['status', 'eq', 'Completed'],
      ['dispatchDate', 'empty'],
    ],
    columns: ['dispatchDate', 'dispatchCarrier', 'awbOut'],
  },
  {
    id: 'completed-no-invoice',
    name: 'Completed, not invoiced',
    description: 'Status is Completed but there is no JRS invoice number.',
    when: [
      ['status', 'eq', 'Completed'],
      ['invoice', 'empty'],
    ],
    columns: ['invoice', 'invoiceDate', 'paymentStatus'],
  },
  {
    id: 'invoiced-not-paid',
    name: 'Invoiced, payment not collected',
    description: 'Has a JRS invoice but no payment collection date.',
    when: [
      ['invoice', 'notEmpty'],
      ['paymentDate', 'empty'],
      ['status', 'neq', 'Cancelled'],
    ],
    columns: ['invoice', 'invoiceDate', 'paymentStatus', 'paymentDate'],
  },
  {
    id: 'received-no-awb',
    name: 'Received, inbound AWB missing',
    description: 'Has a received date but no inbound AWB number.',
    when: [
      ['receivedDate', 'notEmpty'],
      ['awbIn', 'empty'],
    ],
    columns: ['awbIn', 'receivedDate'],
  },
  {
    id: 'received-no-lot',
    name: 'Received, Lot # missing',
    description: 'Has a received date but no Lot #.',
    when: [
      ['receivedDate', 'notEmpty'],
      ['lot', 'empty'],
    ],
    columns: ['lot', 'expiry', 'receivedDate'],
  },
  {
    id: 'active-no-manager',
    name: 'Active, no account manager',
    description: 'Status is Active but no account manager is assigned.',
    when: [
      ['status', 'eq', 'Active'],
      ['accountManager', 'empty'],
    ],
    columns: ['accountManager', 'remarksOnStatus'],
  },
];

/** Built-in reports whose columns exist in this list's schema. */
export function builtInReports(schema: Schema): Report[] {
  const out: Report[] = [];
  for (const p of PRESETS) {
    const conds: Condition[] = [];
    let ok = true;
    p.when.forEach(([k, op, value], i) => {
      const def = schema.bySemantic[k];
      if (!def) ok = false;
      else conds.push({ id: `${p.id}_${i}`, field: def.name, op, value: value ?? '' });
    });
    if (!ok) continue;
    const columns = p.columns.map((k) => schema.bySemantic[k]?.name).filter((n): n is string => !!n);
    const groupBy = p.groupBy ? schema.bySemantic[p.groupBy]?.name : undefined;
    out.push({
      id: p.id,
      name: p.name,
      description: p.description,
      conditions: { match: p.match ?? 'all', conditions: conds },
      columns,
      groupBy,
      builtIn: true,
    });
  }
  return out;
}

/** Lines that match the report, in Folder # / Line # order. */
export function runReport(items: LocalItem[], report: Report, schema: Schema, ctx: ValueContext): LocalItem[] {
  const active = report.conditions.conditions.filter((c) => isComplete(c, schema));
  if (!active.length) return [];
  const hits = items.filter((i) => matchesConditions(i.fields, report.conditions, schema, ctx));
  const folder = schema.bySemantic.folder;
  const line = schema.bySemantic.line;
  const num = (i: LocalItem, d: typeof folder) => {
    const n = d ? Number(displayValue(i.fields, d, ctx).replace(/,/g, '')) : NaN;
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  const byFolder = (a: LocalItem, b: LocalItem) => num(b, folder) - num(a, folder) || num(a, line) - num(b, line);
  const groupDef = report.groupBy ? schema.byName[report.groupBy] : undefined;
  if (!groupDef) return [...hits].sort(byFolder);
  const g = (i: LocalItem) => displayValue(i.fields, groupDef, ctx);
  return [...hits].sort((a, b) => compareGroup(g(a), g(b)) || byFolder(a, b));
}

/** Group titles A–Z, blank ("Not assigned") last. */
function compareGroup(a: string, b: string): number {
  if (!a !== !b) return a ? -1 : 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export const UNASSIGNED = 'Not assigned';

/** Splits sorted report rows into groups by the report's groupBy column. */
export function groupReport(rows: LocalItem[], report: Report, schema: Schema, ctx: ValueContext): ReportGroup[] {
  const groupDef = report.groupBy ? schema.byName[report.groupBy] : undefined;
  if (!groupDef) return [];
  const statusDef = schema.bySemantic.status;
  const out: ReportGroup[] = [];
  const index = new Map<string, ReportGroup>();
  for (const r of rows) {
    const title = displayValue(r.fields, groupDef, ctx) || UNASSIGNED;
    let grp = index.get(title);
    if (!grp) {
      grp = { key: title, title, rows: [], statusCounts: [] };
      index.set(title, grp);
      out.push(grp);
    }
    grp.rows.push(r);
    const st = statusDef ? displayValue(r.fields, statusDef, ctx) || '(blank)' : '';
    if (st) {
      const hit = grp.statusCounts.find((x) => x[0] === st);
      if (hit) hit[1]++;
      else grp.statusCounts.push([st, 1]);
    }
  }
  return out;
}

/** CSV of the report: identity columns, then the report's columns. */
export function reportCsv(rows: LocalItem[], report: Report, schema: Schema, ctx: ValueContext): string {
  const identity = IDENTITY_KEYS.map((k) => schema.bySemantic[k]).filter((d): d is NonNullable<typeof d> => !!d);
  const extra = report.columns.map((n) => schema.byName[n]).filter((d): d is NonNullable<typeof d> => !!d && !identity.includes(d));
  const groupDef = report.groupBy ? schema.byName[report.groupBy] : undefined;
  const defs = [...(groupDef ? [groupDef] : []), ...identity.filter((d) => d !== groupDef), ...extra.filter((d) => d !== groupDef)];
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [defs.map((d) => esc(d.label)).join(',')];
  for (const r of rows) lines.push(defs.map((d) => esc(displayValue(r.fields, d, ctx))).join(','));
  return lines.join('\r\n');
}

export function newReportId(): string {
  return `r${Date.now().toString(36)}`;
}
