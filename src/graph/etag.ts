/**
 * SharePoint list-item eTags look like  "0f5905a8-19bf-49bd-acca-7a9505ce0854,20"  (with the
 * quotes). Some Graph responses (e.g. the listItem `eTag` in delta pages) return the same
 * value WITHOUT the quotes. An unquoted value in If-Match never matches, and SharePoint answers
 * 409 resourceModified even though nobody else changed the item. So every eTag is stored and
 * sent in the quoted form, and compared after normalising.
 */
export function normalizeEtag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v === '*') return v || null;
  if (v.startsWith('W/')) return v;
  const inner = v.replace(/^"+|"+$/g, '');
  return inner ? `"${inner}"` : null;
}

/** True if both eTags identify the same version (quoted or not). */
export function sameEtag(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeEtag(a) === normalizeEtag(b);
}
