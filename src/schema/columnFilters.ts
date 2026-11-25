import type { LocalItem } from '../db/repositories/items';
import type { FieldDef, Schema } from './columnMapper';
import { isoToYmd } from './dates';
import { displayValue, readRaw, type ValueContext } from './values';

/**
 * Excel-style column filters and sorting for the PO list.
 * A column filter is the set of display values to keep ('' = blank) for one column.
 */

export type ColumnFilters = Record<string, string[]>;
export interface ColumnSort {
  field: string;
  dir: 'asc' | 'desc';
}

export const BLANK = '';

export function cellText(item: LocalItem, def: FieldDef, ctx: ValueContext): string {
  return displayValue(item.fields, def, ctx).trim();
}

/** Keeps items whose value in every filtered column is one of the selected values. */
export function applyColumnFilters(
  items: LocalItem[],
  filters: ColumnFilters,
  schema: Schema,
  ctx: ValueContext,
  except?: string,
): LocalItem[] {
  const active = Object.entries(filters).filter(([field, values]) => field !== except && values.length > 0 && schema.byName[field]);
  if (!active.length) return items;
  const sets = active.map(([field, values]) => ({ def: schema.byName[field]!, set: new Set(values) }));
  return items.filter((it) => sets.every(({ def, set }) => set.has(cellText(it, def, ctx))));
}

export interface ValueCount {
  value: string;
  count: number;
}

/** Distinct display values of a column with counts (blank first, then sorted naturally). */
export function distinctValues(items: LocalItem[], def: FieldDef, ctx: ValueContext): ValueCount[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const v = cellText(it, def, ctx);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out = [...counts.entries()].map(([value, count]) => ({ value, count }));
  const sortKey = (v: string) => sortableValue(v, def);
  out.sort((a, b) => {
    if (a.value === BLANK) return -1;
    if (b.value === BLANK) return 1;
    return compareKeys(sortKey(a.value), sortKey(b.value));
  });
  return out;
}

type Key = number | string;

function sortableValue(text: string, def: FieldDef): Key {
  if (['number', 'currency', 'calculated'].includes(def.kind)) {
    const n = Number(text.replace(/,/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return text.toLowerCase();
}

function compareKeys(a: Key, b: Key): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function itemKey(item: LocalItem, def: FieldDef, ctx: ValueContext): Key | null {
  const raw = readRaw(item.fields, def);
  if (raw === null || raw === undefined || raw === '') return null;
  if (def.kind === 'date' || def.kind === 'datetime') {
    return typeof raw === 'string' ? (isoToYmd(raw, ctx.timeZone) ?? raw) : String(raw);
  }
  if (['number', 'currency'].includes(def.kind) && typeof raw === 'number') return raw;
  return sortableValue(cellText(item, def, ctx), def);
}

/** Stable sort by one column; blanks always last. */
export function sortByColumn(items: LocalItem[], sort: ColumnSort, schema: Schema, ctx: ValueContext): LocalItem[] {
  const def = schema.byName[sort.field];
  if (!def) return items;
  const keyed = items.map((item, i) => ({ item, i, k: itemKey(item, def, ctx) }));
  keyed.sort((a, b) => {
    if (a.k === null && b.k === null) return a.i - b.i;
    if (a.k === null) return 1;
    if (b.k === null) return -1;
    const c = compareKeys(a.k, b.k);
    return (sort.dir === 'asc' ? c : -c) || a.i - b.i;
  });
  return keyed.map((x) => x.item);
}

export function activeColumnFilterCount(filters: ColumnFilters): number {
  return Object.values(filters).filter((v) => v.length > 0).length;
}

/** Display width for a column in the table views. */
export function columnWidth(def: FieldDef): number {
  if (def.semantic === 'folder') return 84;
  if (def.semantic === 'line') return 56;
  switch (def.kind) {
    case 'number':
    case 'currency':
    case 'calculated':
      return 100;
    case 'boolean':
      return 90;
    case 'date':
    case 'datetime':
      return 120;
    case 'choice':
    case 'multichoice':
    case 'person':
      return 160;
    case 'note':
      return 240;
    default:
      return def.semantic === 'product' || def.semantic === 'customer' ? 230 : 170;
  }
}
