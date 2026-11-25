import type { LocalItem } from '../db/repositories/items';
import type { Schema } from './columnMapper';
import { displayValue, fieldKey, type ValueContext } from './values';

/** One Folder # with all of its PO lines. */
export interface FolderGroup {
  key: string;
  /** Folder # value ('' when the line has none). */
  folder: string;
  /** Customer name(s) on the lines (usually one). */
  customer: string;
  lines: LocalItem[];
  statuses: string[];
  dirty: boolean;
}

function lineNumber(item: LocalItem, schema: Schema): number {
  const def = schema.bySemantic.line;
  const v = def ? item.fields[fieldKey(def)] : null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Groups PO lines by Folder #. Groups keep the order in which their first line appears in
 * `items` (so the list's sort still applies); lines inside a group are ordered by Line #.
 * Lines without a Folder # each form their own group.
 */
export function groupByFolder(items: LocalItem[], schema: Schema, ctx: ValueContext, sortByFolderDesc = false): FolderGroup[] {
  const folderDef = schema.bySemantic.folder;
  const customerDef = schema.bySemantic.customer;
  const statusDef = schema.bySemantic.status;
  const groups = new Map<string, FolderGroup>();

  for (const item of items) {
    const folder = folderDef ? displayValue(item.fields, folderDef, ctx).trim() : '';
    const key = folder ? `f:${folder.toLowerCase()}` : `i:${item.localId}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, folder, customer: '', lines: [], statuses: [], dirty: false };
      groups.set(key, g);
    }
    g.lines.push(item);
    g.dirty = g.dirty || item.dirty;
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.lines.sort((a, b) => lineNumber(a, schema) - lineNumber(b, schema));
    const customers = new Set<string>();
    const statuses = new Set<string>();
    for (const l of g.lines) {
      if (customerDef) {
        const c = displayValue(l.fields, customerDef, ctx);
        if (c) customers.add(c);
      }
      if (statusDef) {
        const s = displayValue(l.fields, statusDef, ctx);
        if (s) statuses.add(s);
      }
    }
    g.customer = [...customers].join(', ');
    g.statuses = [...statuses];
  }

  if (sortByFolderDesc) {
    out.sort((a, b) => {
      const na = Number(a.folder);
      const nb = Number(b.folder);
      if (!a.folder) return 1;
      if (!b.folder) return -1;
      if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
      return b.folder.localeCompare(a.folder);
    });
  }
  return out;
}
