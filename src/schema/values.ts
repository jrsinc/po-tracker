import type { FieldValues } from '../graph/types';
import type { FieldDef, Schema } from './columnMapper';
import { formatYmd, isoToYmd, isValidYmd, ymdToIso } from './dates';

/** Value held by an edit form control. */
export type FormValue = string | boolean | string[] | null;
export type FormValues = Record<string, FormValue>;

export interface ValueContext {
  timeZone: string;
  /** Person lookup id -> display name. */
  people: Record<string, string>;
}

/** Key under which Graph returns/accepts the value (Person columns use "<name>LookupId"). */
export function fieldKey(def: FieldDef): string {
  return def.kind === 'person' ? `${def.name}LookupId` : def.name;
}

export function readRaw(fields: FieldValues, def: FieldDef): unknown {
  return fields[fieldKey(def)];
}

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Human-readable value for lists and the detail screen. */
export function displayValue(fields: FieldValues, def: FieldDef, ctx: ValueContext): string {
  const raw = readRaw(fields, def);
  if (isEmpty(raw)) return '';
  switch (def.kind) {
    case 'date': {
      const ymd = typeof raw === 'string' ? isoToYmd(raw, ctx.timeZone) : null;
      return ymd ? formatYmd(ymd) : String(raw);
    }
    case 'datetime': {
      const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
      return Number.isNaN(t) ? String(raw) : new Date(t).toLocaleString();
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 ? 'Yes' : 'No';
    case 'person':
      return ctx.people[String(raw)] ?? `User #${String(raw)}`;
    case 'multichoice':
      return Array.isArray(raw) ? raw.join(', ') : String(raw);
    case 'number':
    case 'currency':
      return typeof raw === 'number' ? String(raw) : String(raw);
    default:
      return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
}

/** Plain text used for searching and sorting. */
export function textValue(fields: FieldValues, def: FieldDef, ctx: ValueContext): string {
  return displayValue(fields, def, ctx);
}

/** Graph value -> form value. */
export function toFormValue(fields: FieldValues, def: FieldDef, ctx: ValueContext): FormValue {
  const raw = readRaw(fields, def);
  switch (def.kind) {
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1;
    case 'date':
      return typeof raw === 'string' ? isoToYmd(raw, ctx.timeZone) : null;
    case 'multichoice':
      return Array.isArray(raw) ? raw.map(String) : isEmpty(raw) ? [] : [String(raw)];
    default:
      return isEmpty(raw) ? '' : String(raw);
  }
}

/** Form value -> value to PATCH/POST to Graph. Empty values clear the column (null). */
export function toGraphValue(value: FormValue, def: FieldDef, ctx: ValueContext): unknown {
  if (def.kind === 'boolean') return value === true;
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  switch (def.kind) {
    case 'number':
    case 'currency':
      return Number(String(value).replace(/,/g, ''));
    case 'date':
      return ymdToIso(String(value), ctx.timeZone);
    case 'datetime':
      return new Date(String(value)).toISOString();
    case 'multichoice':
      return Array.isArray(value) ? value : [String(value)];
    case 'person':
      return String(value);
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

export function formFromFields(fields: FieldValues, schema: Schema, ctx: ValueContext): FormValues {
  const out: FormValues = {};
  for (const f of schema.fields) out[f.name] = toFormValue(fields, f, ctx);
  return out;
}

function sameForm(a: FormValue, b: FormValue): boolean {
  const norm = (v: FormValue) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join('\u0001') : String(v));
  return norm(a) === norm(b);
}

/**
 * Graph payload with only the editable fields that changed between `before` and `after`.
 * Keys are Graph keys (Person columns -> "<name>LookupId").
 */
export function diffToGraph(before: FormValues, after: FormValues, schema: Schema, ctx: ValueContext): FieldValues {
  const out: FieldValues = {};
  for (const f of schema.fields) {
    if (f.readOnly) continue;
    if (!(f.name in after)) continue;
    if (sameForm(before[f.name] ?? null, after[f.name] ?? null)) continue;
    out[fieldKey(f)] = toGraphValue(after[f.name] ?? null, f, ctx);
  }
  return out;
}

/** Full payload for a new item (only non-empty editable fields). */
export function formToGraphCreate(values: FormValues, schema: Schema, ctx: ValueContext): FieldValues {
  const out: FieldValues = {};
  for (const f of schema.fields) {
    if (f.readOnly) continue;
    const v = values[f.name] ?? null;
    if (f.kind === 'boolean' ? v !== true : isEmpty(v)) continue;
    out[fieldKey(f)] = toGraphValue(v, f, ctx);
  }
  return out;
}

export type ValidationErrors = Record<string, string>;

export function validateForm(values: FormValues, schema: Schema): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const f of schema.fields) {
    if (f.readOnly) continue;
    const v = values[f.name] ?? null;
    const empty = f.kind === 'boolean' ? false : isEmpty(v);
    if (f.required && empty) {
      errors[f.name] = `${f.label} is required.`;
      continue;
    }
    if (empty) continue;
    const s = typeof v === 'string' ? v.trim() : '';
    switch (f.kind) {
      case 'number':
      case 'currency': {
        const n = Number(s.replace(/,/g, ''));
        if (!s || Number.isNaN(n)) errors[f.name] = `${f.label} must be a number.`;
        else if (f.decimalPlaces === 0 && !Number.isInteger(n)) errors[f.name] = `${f.label} must be a whole number.`;
        break;
      }
      case 'date':
        if (!isValidYmd(s)) errors[f.name] = `${f.label} must be a valid date (YYYY-MM-DD).`;
        break;
      case 'choice':
        if (!f.allowTextEntry && f.choices.length && !f.choices.includes(s)) {
          errors[f.name] = `Choose a value from the list for ${f.label}.`;
        }
        break;
      case 'text':
        if (f.maxLength && s.length > f.maxLength) {
          errors[f.name] = `${f.label} must be ${f.maxLength} characters or fewer.`;
        }
        break;
      default:
        break;
    }
  }
  return errors;
}
