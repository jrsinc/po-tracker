import {
  FIELD_GROUPS,
  normaliseName,
  OTHER_GROUP,
  type GroupSpec,
  type SemanticKey,
} from '../config/schemaGroups';
import type { ColumnDefinition } from '../graph/types';

export type FieldKind =
  | 'text'
  | 'note'
  | 'number'
  | 'currency'
  | 'choice'
  | 'multichoice'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'person'
  | 'calculated'
  | 'unsupported';

export interface FieldDef {
  /** SharePoint internal name (from the schema; never hard-coded). */
  name: string;
  displayName: string;
  /** Label shown in the UI. */
  label: string;
  kind: FieldKind;
  required: boolean;
  readOnly: boolean;
  choices: string[];
  allowTextEntry: boolean;
  multiline: boolean;
  maxLength?: number;
  decimalPlaces?: number;
  groupKey: string;
  order: number;
  semantic?: SemanticKey;
}

export interface FieldGroup {
  key: string;
  title: string;
  fields: FieldDef[];
}

export interface Schema {
  fields: FieldDef[];
  groups: FieldGroup[];
  byName: Record<string, FieldDef>;
  bySemantic: Partial<Record<SemanticKey, FieldDef>>;
}

/** SharePoint system columns that are never shown, even if Graph reports them as visible. */
const SYSTEM_COLUMNS = new Set([
  'ID',
  'ContentType',
  'ContentTypeId',
  'Attachments',
  'Edit',
  'LinkTitle',
  'LinkTitleNoMenu',
  'LinkTitle2',
  'DocIcon',
  'ItemChildCount',
  'FolderChildCount',
  'Created',
  'Modified',
  'Author',
  'Editor',
  'AppAuthor',
  'AppEditor',
  'ComplianceAssetId',
  'SelectTitle',
]);

/** Internal names starting with "_" are system columns, except encoded names like "_x0077_tp0". */
function isSystemName(name: string): boolean {
  if (SYSTEM_COLUMNS.has(name)) return true;
  return /^_(?!x[0-9a-f]{4}_)/i.test(name);
}

export function columnKind(c: ColumnDefinition): FieldKind {
  if (c.calculated) return 'calculated';
  if (c.text) return c.text.allowMultipleLines ? 'note' : 'text';
  if (c.number) return 'number';
  if (c.currency) return 'currency';
  if (c.choice) return c.choice.displayAs === 'checkBoxes' ? 'multichoice' : 'choice';
  if (c.dateTime) return c.dateTime.format === 'dateTime' ? 'datetime' : 'date';
  if (c.boolean) return 'boolean';
  if (c.personOrGroup) return c.personOrGroup.allowMultipleSelection ? 'unsupported' : 'person';
  return 'unsupported';
}

function toFieldDef(c: ColumnDefinition): FieldDef {
  const kind = columnKind(c);
  const decimals = c.number?.decimalPlaces;
  const decimalPlaces =
    decimals && /^\d+$/.test(decimals) ? Number(decimals) : decimals === 'none' ? 0 : undefined;
  return {
    name: c.name,
    displayName: c.displayName,
    label: c.displayName,
    kind,
    required: !!c.required,
    readOnly: !!c.readOnly || kind === 'calculated' || kind === 'unsupported',
    choices: [...new Set(c.choice?.choices ?? [])],
    allowTextEntry: !!c.choice?.allowTextEntry,
    multiline: kind === 'note',
    maxLength: kind === 'text' ? (c.text?.maxLength ?? 255) : undefined,
    decimalPlaces,
    groupKey: OTHER_GROUP.key,
    order: 0,
  };
}

/** Columns the app should show: visible, editable (or calculated), non-system. */
export function isUserColumn(c: ColumnDefinition): boolean {
  if (c.hidden) return false;
  if (isSystemName(c.name)) return false;
  if (c.readOnly && !c.calculated) return false;
  return true;
}

/**
 * Builds the app schema from the Graph column definitions.
 * - Matches columns to groups by display name (aliases in schemaGroups.ts).
 * - Columns sharing a display name are each kept, labelled "Name (2)" etc.
 * - Anything unmatched goes to "Other", in schema order.
 */
export function buildSchema(columns: ColumnDefinition[], groups: GroupSpec[] = FIELD_GROUPS): Schema {
  const usable = columns.filter(isUserColumn);
  const defs = usable.map(toFieldDef);
  const assigned = new Set<number>();
  const outGroups: FieldGroup[] = [];
  const bySemantic: Partial<Record<SemanticKey, FieldDef>> = {};

  // Label duplicates "(2)", "(3)" in schema order.
  const seen = new Map<string, number>();
  defs.forEach((d) => {
    const key = normaliseName(d.displayName);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) d.label = `${d.displayName} (${n})`;
  });

  let order = 0;
  for (const g of groups) {
    const fields: FieldDef[] = [];
    for (const spec of g.fields) {
      const aliases = spec.aliases.map(normaliseName);
      // Every unassigned column with a matching display name lands here, in alias priority order.
      for (const alias of aliases) {
        defs.forEach((d, i) => {
          if (assigned.has(i) || normaliseName(d.displayName) !== alias) return;
          assigned.add(i);
          if (spec.label && !/\(\d+\)$/.test(d.label)) d.label = spec.label;
          d.groupKey = g.key;
          d.order = order++;
          if (spec.semantic && !bySemantic[spec.semantic]) {
            d.semantic = spec.semantic;
            bySemantic[spec.semantic] = d;
          }
          fields.push(d);
        });
      }
    }
    if (fields.length) outGroups.push({ key: g.key, title: g.title, fields });
  }

  const other = defs.filter((_, i) => !assigned.has(i));
  other.forEach((d) => {
    d.groupKey = OTHER_GROUP.key;
    d.order = order++;
  });
  if (other.length) outGroups.push({ key: OTHER_GROUP.key, title: OTHER_GROUP.title, fields: other });

  const fields = outGroups.flatMap((g) => g.fields);
  const byName: Record<string, FieldDef> = {};
  fields.forEach((f) => (byName[f.name] = f));
  return { fields, groups: outGroups, byName, bySemantic };
}
