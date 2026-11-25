import type { FieldValues } from '../graph/types';
import type { FieldDef, FieldKind, Schema } from './columnMapper';
import { formatYmd, isoToYmd } from './dates';
import { displayValue, isEmpty, readRaw, type ValueContext } from './values';

/** Condition-based filtering for the PO list ("Status is Ready to Ship AND Received date after …"). */

export type Op =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'on'
  | 'before'
  | 'after'
  | 'isTrue'
  | 'isFalse'
  | 'empty'
  | 'notEmpty';

export interface Condition {
  id: string;
  /** SharePoint internal column name (from the schema). */
  field: string;
  op: Op;
  value: string;
  /**
   * How this condition joins the one before it. Conditions joined by OR form a bracket, and
   * brackets are joined by AND:  A OR B AND C  means  (A or B) and C.
   * Missing = the set's `match` (all = AND, any = OR), for older saved filters.
   */
  join?: 'and' | 'or';
}

export interface ConditionSet {
  match: 'all' | 'any';
  conditions: Condition[];
}

export const EMPTY_CONDITIONS: ConditionSet = { match: 'all', conditions: [] };

export interface OpInfo {
  op: Op;
  label: string;
  needsValue: boolean;
}

const O = (op: Op, label: string, needsValue = true): OpInfo => ({ op, label, needsValue });
const EMPTY_OPS = [O('empty', 'is empty', false), O('notEmpty', 'is not empty', false)];

/** Operators offered for a column type. */
export function opsFor(kind: FieldKind): OpInfo[] {
  switch (kind) {
    case 'number':
    case 'currency':
    case 'calculated':
      return [O('eq', '='), O('neq', '≠'), O('gt', '>'), O('gte', '≥'), O('lt', '<'), O('lte', '≤'), ...EMPTY_OPS];
    case 'date':
    case 'datetime':
      return [O('on', 'is on'), O('before', 'is before'), O('after', 'is after'), ...EMPTY_OPS];
    case 'choice':
    case 'multichoice':
    case 'person':
      return [O('eq', 'is'), O('neq', 'is not'), O('contains', 'contains'), ...EMPTY_OPS];
    case 'boolean':
      return [O('isTrue', 'is Yes', false), O('isFalse', 'is No', false)];
    default:
      return [
        O('contains', 'contains'),
        O('notContains', 'does not contain'),
        O('eq', 'is'),
        O('neq', 'is not'),
        O('startsWith', 'starts with'),
        ...EMPTY_OPS,
      ];
  }
}

export function opInfo(kind: FieldKind, op: Op): OpInfo | undefined {
  return opsFor(kind).find((o) => o.op === op);
}

/** A condition with a missing value is ignored (treated as not set yet). */
export function isComplete(c: Condition, schema: Schema): boolean {
  const def = schema.byName[c.field];
  if (!def) return false;
  const info = opInfo(def.kind, c.op);
  if (!info) return false;
  return !info.needsValue || c.value.trim() !== '';
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function testOne(fields: FieldValues, c: Condition, def: FieldDef, ctx: ValueContext): boolean {
  const raw = readRaw(fields, def);
  if (c.op === 'empty') return isEmpty(raw);
  if (c.op === 'notEmpty') return !isEmpty(raw);
  if (c.op === 'isTrue') return raw === true || raw === 'true' || raw === 1;
  if (c.op === 'isFalse') return !(raw === true || raw === 'true' || raw === 1);

  const want = c.value.trim();

  if (def.kind === 'date' || def.kind === 'datetime') {
    const have = typeof raw === 'string' ? isoToYmd(raw, ctx.timeZone) : null;
    if (!have) return false;
    if (c.op === 'on') return have === want;
    if (c.op === 'before') return have < want;
    if (c.op === 'after') return have > want;
    return false;
  }

  if (['number', 'currency', 'calculated'].includes(def.kind) && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.op)) {
    const a = toNumber(raw);
    const b = toNumber(want);
    if (b === null) return true;
    if (a === null) return c.op === 'neq';
    switch (c.op) {
      case 'eq':
        return a === b;
      case 'neq':
        return a !== b;
      case 'gt':
        return a > b;
      case 'gte':
        return a >= b;
      case 'lt':
        return a < b;
      default:
        return a <= b;
    }
  }

  // Choice / person "is": compare the stored value (person = lookup id) exactly.
  if ((def.kind === 'choice' || def.kind === 'person' || def.kind === 'multichoice') && (c.op === 'eq' || c.op === 'neq')) {
    const values = Array.isArray(raw) ? raw.map(String) : isEmpty(raw) ? [] : [String(raw)];
    const hit = values.some((v) => v.toLowerCase() === want.toLowerCase());
    return c.op === 'eq' ? hit : !hit;
  }

  const text = displayValue(fields, def, ctx).toLowerCase();
  const w = want.toLowerCase();
  switch (c.op) {
    case 'contains':
      return text.includes(w);
    case 'notContains':
      return !text.includes(w);
    case 'startsWith':
      return text.startsWith(w);
    case 'eq':
      return text === w;
    case 'neq':
      return text !== w;
    default:
      return true;
  }
}

/** True if the item passes the condition set (incomplete conditions are ignored). */
export function matchesConditions(fields: FieldValues, set: ConditionSet, schema: Schema, ctx: ValueContext): boolean {
  const brackets = conditionGroups(set, schema);
  if (!brackets.length) return true;
  return brackets.every((g) => g.some((c) => testOne(fields, c, schema.byName[c.field]!, ctx)));
}

/** The join actually used before condition `c` (ignored for the first one). */
export function joinOf(c: Condition, set: ConditionSet): 'and' | 'or' {
  return c.join ?? (set.match === 'all' ? 'and' : 'or');
}

/** Complete conditions split into OR-brackets; the brackets are ANDed together. */
export function conditionGroups(set: ConditionSet, schema: Schema): Condition[][] {
  const out: Condition[][] = [];
  for (const c of set.conditions.filter((x) => isComplete(x, schema))) {
    const last = out[out.length - 1];
    if (last && joinOf(c, set) === 'or') last.push(c);
    else out.push([c]);
  }
  return out;
}

/** e.g. '(Status is “Active” OR Status is “Ready to Ship”) AND Outbound AWB # is empty'. */
export function describeConditions(set: ConditionSet, schema: Schema, ctx: ValueContext): string {
  const groups = conditionGroups(set, schema);
  return groups
    .map((g) => {
      const text = g.map((c) => describeCondition(c, schema, ctx)).join('  OR  ');
      return g.length > 1 && groups.length > 1 ? `(${text})` : text;
    })
    .join('  AND  ');
}

export function activeConditionCount(set: ConditionSet, schema: Schema | null): number {
  return schema ? set.conditions.filter((c) => isComplete(c, schema)).length : 0;
}

/** Human-readable summary, e.g. 'Status is Ready to Ship'. */
export function describeCondition(c: Condition, schema: Schema, ctx: ValueContext): string {
  const def = schema.byName[c.field];
  if (!def) return '';
  const info = opInfo(def.kind, c.op);
  let value = c.value;
  if (def.kind === 'person') value = ctx.people[c.value] ?? c.value;
  if ((def.kind === 'date' || def.kind === 'datetime') && /^\d{4}-\d{2}-\d{2}$/.test(c.value)) value = formatYmd(c.value);
  return [def.label, info?.label ?? c.op, info?.needsValue ? `“${value}”` : ''].filter(Boolean).join(' ');
}
