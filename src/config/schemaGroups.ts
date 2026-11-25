/**
 * How list columns are grouped and labelled in the app.
 *
 * Matching is by DISPLAY NAME (normalised: case-insensitive, whitespace ignored), never by
 * SharePoint internal name. Each field lists every display name it is known by (the original
 * spreadsheet heading and the current SharePoint column title). The real schema loaded from
 * Graph is authoritative: columns that match nothing here are shown under "Other".
 *
 * `semantic` keys let the rest of the app find well-known columns (search, filters,
 * notifications, document folder) without knowing internal names.
 */

export type SemanticKey =
  | 'folder'
  | 'line'
  | 'service'
  | 'status'
  | 'accountManager'
  | 'remarksOnStatus'
  | 'remarks'
  | 'customer'
  | 'customerPo'
  | 'salesOrder'
  | 'vendor'
  | 'vendorPo'
  | 'invoice'
  | 'paymentStatus'
  | 'product'
  | 'expiry'
  | 'receivedDate'
  | 'dispatchDate'
  | 'awbIn'
  | 'awbOut'
  | 'dispatchCarrier'
  | 'invoiceDate'
  | 'paymentDate'
  | 'lot';

export interface FieldSpec {
  aliases: string[];
  /** Overrides the SharePoint display name in the UI. */
  label?: string;
  semantic?: SemanticKey;
}

export interface GroupSpec {
  key: string;
  title: string;
  fields: FieldSpec[];
}

export const OTHER_GROUP = { key: 'other', title: 'Other' } as const;

export const FIELD_GROUPS: GroupSpec[] = [
  {
    key: 'order',
    title: 'Order',
    fields: [
      { aliases: ['FOLDER #', 'Folder', 'Title'], label: 'Folder #', semantic: 'folder' },
      { aliases: ['LINE#', 'Line #'], label: 'Line #', semantic: 'line' },
      { aliases: ['SERVICE'], semantic: 'service' },
      { aliases: ['STATUS'], semantic: 'status' },
      { aliases: ['ACCOUNT MANAGER'], semantic: 'accountManager' },
      { aliases: ['REMARKS ON STATUS'], semantic: 'remarksOnStatus' },
      { aliases: ['REMARK (ENTRY DONE BY WHOM WITH STATUS)', 'Remarks', 'Remark'], semantic: 'remarks' },
      { aliases: ['Account Manager Update'] },
    ],
  },
  {
    key: 'customer',
    title: 'Customer',
    fields: [
      { aliases: ['CUSTOMER NAME', 'Customer'], semantic: 'customer' },
      { aliases: ['COUNTRY'] },
      { aliases: ['CUSTOMER PO#', 'Customer PO'], label: 'Customer PO #', semantic: 'customerPo' },
      { aliases: ['CUSTOMER PO DATE'] },
    ],
  },
  {
    key: 'sales',
    title: 'Sales order',
    fields: [
      { aliases: ['JRS PI/SO#', 'JRS SO/ PI #', 'JRS SO/PI #'], label: 'JRS SO / PI #', semantic: 'salesOrder' },
      { aliases: ['ACTUAL SO DATE'], label: 'Actual SO date' },
    ],
  },
  {
    key: 'vendor',
    title: 'Vendor',
    fields: [
      { aliases: ['VENDOR NAME'], semantic: 'vendor' },
      { aliases: ['VENDOR PO#', 'Vendor PO'], label: 'Vendor PO #', semantic: 'vendorPo' },
      { aliases: ['ACTUAL PO DATE'] },
      { aliases: ['SOURCE COUNTRY'] },
    ],
  },
  {
    key: 'invoice',
    title: 'Invoice and payment',
    fields: [
      { aliases: ['JRS INVOICE#', 'JRS Invoice'], label: 'JRS Invoice #', semantic: 'invoice' },
      { aliases: ['JRS INVOICE DATE'], semantic: 'invoiceDate' },
      { aliases: ['PAYMENT STATUS'], semantic: 'paymentStatus' },
      { aliases: ['PAYMENT COLLECTION DATE'], semantic: 'paymentDate' },
    ],
  },
  {
    key: 'product',
    title: 'Product',
    fields: [
      { aliases: ['PRODUCT NAME'], semantic: 'product' },
      { aliases: ['NDC# / MA#'] },
      { aliases: ['Product Source Country'] },
      { aliases: ['Quantity'] },
      { aliases: ['STORAGE TEMPERATURE', 'Temperature Requirement'] },
      { aliases: ['LOT#', 'LOT'], label: 'Lot #', semantic: 'lot' },
      { aliases: ['EXPIRY DATE'], semantic: 'expiry' },
      { aliases: ['STORAGE LOCATIONS', 'Storage location'] },
      { aliases: ['EPCIS FILE REQUIRED', 'EPCIS Data Required'] },
    ],
  },
  {
    key: 'receiving',
    title: 'Receiving',
    fields: [
      { aliases: ['RECEIVED DATE'], semantic: 'receivedDate' },
      { aliases: ['Carrier'], label: 'Inbound carrier' },
      { aliases: ['Quantity Received'] },
      { aliases: ['AWB'], label: 'Inbound AWB #', semantic: 'awbIn' },
    ],
  },
  {
    key: 'dispatch',
    title: 'Dispatch',
    fields: [
      { aliases: ['DISPATCH DATE'], semantic: 'dispatchDate' },
      { aliases: ['Carrier through'], label: 'Dispatch carrier', semantic: 'dispatchCarrier' },
      { aliases: ['Qty'], label: 'Qty dispatched' },
      { aliases: ['AWB#'], label: 'Outbound AWB #', semantic: 'awbOut' },
    ],
  },
  {
    key: 'costs',
    title: 'Costs and timing',
    fields: [
      { aliases: ['Fedex inbound Cost'] },
      { aliases: ['Fedex Outbound Cost'] },
      { aliases: ['Ready To Ship- Days', 'Ready To Ship - Days'] },
    ],
  },
];

/** Normalise a display name for matching: upper case, no whitespace. */
export function normaliseName(name: string): string {
  return name.toUpperCase().replace(/\s+/g, '');
}

/** Semantic keys used for the list search box. */
export const SEARCH_KEYS: SemanticKey[] = [
  'folder',
  'customer',
  'customerPo',
  'vendorPo',
  'salesOrder',
  'product',
  'invoice',
];

/** Semantic keys offered as filters on the PO list. */
export const FILTER_KEYS: SemanticKey[] = ['status', 'paymentStatus', 'service', 'accountManager'];

/** Statuses that mean a PO is finished (used by "ready to ship" alerts). */
export const CLOSED_STATUSES = ['Completed', 'Cancelled'];
