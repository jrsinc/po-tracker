/** Document types offered when adding a file; the prefix starts the uploaded file name. */
export const DOC_TYPES = [
  { key: 'customer_po', label: 'Customer PO', prefix: 'CustomerPO' },
  { key: 'vendor_po', label: 'Vendor PO', prefix: 'VendorPO' },
  { key: 'invoice', label: 'Invoice', prefix: 'Invoice' },
  { key: 'awb', label: 'AWB', prefix: 'AWB' },
  { key: 'packing_slip', label: 'Packing slip', prefix: 'PackingSlip' },
  { key: 'other', label: 'Other', prefix: 'Other' },
] as const;

export type DocTypeKey = (typeof DOC_TYPES)[number]['key'];

export function docTypePrefix(key: string): string {
  return DOC_TYPES.find((d) => d.key === key)?.prefix ?? 'Other';
}

// Characters SharePoint Online does not allow in file or folder names.
const ILLEGAL = /["*:<>?/\\|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|desktop\.ini|\.lock|_vti_)$/i;
const MAX_NAME = 200;

/**
 * Makes a single path segment (file or folder name) valid for SharePoint:
 * replaces illegal characters, trims spaces and trailing dots, avoids reserved names,
 * and keeps the length reasonable while preserving the extension.
 */
export function sanitizeName(name: string, fallback = 'file'): string {
  let s = name.normalize('NFC').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^~\$/, '_').replace(/^\.+/, '').replace(/[.\s]+$/, '');
  if (s.includes('_vti_')) s = s.replace(/_vti_/g, '_vti');
  const dot = s.lastIndexOf('.');
  const base = dot > 0 ? s.slice(0, dot) : s;
  if (!s || RESERVED.test(base) || RESERVED.test(s)) s = `_${s || fallback}`;
  if (s.length > MAX_NAME) {
    const ext = dot > 0 ? s.slice(dot) : '';
    s = s.slice(0, MAX_NAME - ext.length).trimEnd() + ext;
  }
  return s || fallback;
}

/** "{TypePrefix}_{original name}", sanitised. */
export function buildTargetName(docType: string, originalName: string): string {
  return sanitizeName(`${docTypePrefix(docType)}_${sanitizeName(originalName)}`);
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
}

/** Folder holding a PO's documents: {base folder}/{FOLDER # value}. */
export function poFolderPath(baseFolder: string, folderValue: string): string {
  const base = baseFolder
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => sanitizeName(s, 'folder'));
  return joinPath(...base, sanitizeName(folderValue, 'folder'));
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Gives camera photos and nameless picks a sensible file name. */
export function ensureFileName(name: string | null | undefined, mimeType: string | null | undefined, now: number): string {
  if (name && name.trim()) return name.trim();
  const ext = (mimeType && EXT_BY_MIME[mimeType]) || 'bin';
  const d = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '_');
  return `photo_${d}.${ext}`;
}

/** Parses the start offset from an upload session range like "3276800-" or "0-1023". */
export function parseRangeStart(range: string | undefined): number | null {
  if (!range) return null;
  const m = /^(\d+)-/.exec(range);
  return m ? Number(m[1]) : null;
}
