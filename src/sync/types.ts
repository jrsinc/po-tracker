import type { FieldValues } from '../graph/types';

export type ChangeKind = 'created' | 'updated' | 'deleted';

/** A change that arrived from SharePoint (used for notifications and UI refresh). */
export interface ChangeEvent {
  kind: ChangeKind;
  localId: string;
  spId: string;
  before: FieldValues | null;
  after: FieldValues | null;
  modifiedBy: string | null;
}

export interface DownResult {
  mode: 'full' | 'delta';
  changes: ChangeEvent[];
  /** Items deleted in SharePoint that were kept because they have unsynced local edits. */
  discarded: string[];
}

export interface UpResult {
  sent: number;
  conflicts: number;
  failed: number;
  /** True if processing stopped early because of a network / throttling error. */
  interrupted: boolean;
}

export class DeltaExpiredError extends Error {
  constructor() {
    super('Delta token expired; a full resync is required.');
    this.name = 'DeltaExpiredError';
  }
}

export const TEMP_PREFIX = 'tmp_';

export function isTempId(localId: string): boolean {
  return localId.startsWith(TEMP_PREFIX);
}

/** Removes OData annotations (e.g. "@odata.etag") from a Graph field set. */
export function cleanFields(fields: FieldValues | undefined): FieldValues {
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (!k.startsWith('@odata')) out[k] = v;
  }
  return out;
}
