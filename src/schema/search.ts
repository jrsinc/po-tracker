import { SEARCH_KEYS } from '../config/schemaGroups';
import type { FieldValues } from '../graph/types';
import type { Schema } from './columnMapper';
import { fieldKey } from './values';

/** Builds the function that produces an item's lower-cased search text. */
export function buildIndexer(schema: Schema | null): (fields: FieldValues) => string {
  if (!schema) return () => '';
  const keys = SEARCH_KEYS.map((k) => schema.bySemantic[k])
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map(fieldKey);
  return (fields) =>
    keys
      .map((k) => fields[k])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map((v) => String(v))
      .join(' ')
      .toLowerCase();
}
