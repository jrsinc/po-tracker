/** Subset of Microsoft Graph v1.0 resource shapes used by the app. */

export interface Paged<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface IdentitySet {
  user?: { id?: string; displayName?: string; email?: string };
}

export type FieldValues = Record<string, unknown>;

export interface GraphListItem {
  id: string;
  eTag?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: IdentitySet;
  createdBy?: IdentitySet;
  fields?: FieldValues;
  /** Present on delta results for removed items. */
  deleted?: { state?: string };
  '@removed'?: { reason?: string };
}

export interface ColumnDefinition {
  id?: string;
  name: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  readOnly?: boolean;
  required?: boolean;
  indexed?: boolean;
  columnGroup?: string;
  text?: { allowMultipleLines?: boolean; maxLength?: number; textType?: string };
  number?: { decimalPlaces?: string; minimum?: number; maximum?: number };
  currency?: { locale?: string };
  choice?: { allowTextEntry?: boolean; choices?: string[]; displayAs?: string };
  dateTime?: { displayAs?: string; format?: 'dateOnly' | 'dateTime' };
  boolean?: Record<string, never>;
  personOrGroup?: { allowMultipleSelection?: boolean; chooseFromType?: string };
  calculated?: { formula?: string; outputType?: string; format?: string };
  lookup?: { listId?: string; columnName?: string; allowMultipleValues?: boolean };
  hyperlinkOrPicture?: { isPicture?: boolean };
}

export interface GraphSite {
  id: string;
  displayName?: string;
  webUrl?: string;
}

export interface GraphList {
  id: string;
  name?: string;
  displayName: string;
}

export interface GraphDrive {
  id: string;
  name: string;
  webUrl?: string;
}

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: IdentitySet;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  '@microsoft.graph.downloadUrl'?: string;
}

export interface UploadSession {
  uploadUrl: string;
  expirationDateTime?: string;
  nextExpectedRanges?: string[];
}

export interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
}
