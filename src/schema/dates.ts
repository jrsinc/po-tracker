/**
 * Date helpers. SharePoint stores date-only columns as midnight in the SITE time zone,
 * expressed in UTC (this site: Pacific, so 08:00Z in winter / 07:00Z in summer). Reading or
 * writing them in the device time zone would shift dates by a day, so all conversion goes
 * through the site time zone.
 */

export type YMD = string; // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0');

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(instant: number, timeZone: string): Parts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset of the time zone from UTC at the given instant, in ms (e.g. -8h for PST). */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** ISO instant -> calendar date in the given time zone. */
export function isoToYmd(iso: string, timeZone: string): YMD | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const p = partsIn(t, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Calendar date -> ISO instant of midnight in the given time zone (what SharePoint stores). */
export function ymdToIso(ymd: YMD, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let instant = guess - tzOffsetMs(guess, timeZone);
  // Correct across DST boundaries.
  instant = guess - tzOffsetMs(instant, timeZone);
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

export function isValidYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Today's date in the given time zone. */
export function todayYmd(timeZone: string, now: number = Date.now()): YMD {
  const p = partsIn(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: YMD, b: YMD): number {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((pb - pa) / 86_400_000);
}

/** Display format, e.g. "1 Jan 2026". */
export function formatYmd(ymd: YMD): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/**
 * The list's "Expiry Date" is free text in many formats: "12/2026", "Sep-27", "Apr-29",
 * "31 JAN 2027", "2027-01-31", "1/31/2027". Month-only values expire at the end of the month.
 * Returns null when the text is not a recognisable date (e.g. "NA").
 */
export function parseExpiry(text: string | null | undefined): YMD | null {
  if (!text) return null;
  const s = text.trim().toUpperCase();
  let m: RegExpExecArray | null;
  const ymd = (y: number, mo: number, d?: number): YMD | null => {
    if (mo < 1 || mo > 12 || y < 1900 || y > 2200) return null;
    const day = d ?? lastDayOfMonth(y, mo);
    if (day < 1 || day > lastDayOfMonth(y, mo)) return null;
    return `${y}-${pad(mo)}-${pad(day)}`;
  };

  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return ymd(+m[1]!, +m[2]!);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) return ymd(fullYear(+m[3]!), +m[1]!, +m[2]!);
  if ((m = /^(\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) return ymd(fullYear(+m[2]!), +m[1]!);
  if ((m = /^(\d{1,2})[\s-]+([A-Z]{3,4})[A-Z]*[\s,-]+(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[2]!];
    return mo ? ymd(fullYear(+m[3]!), mo, +m[1]!) : null;
  }
  if ((m = /^([A-Z]{3,4})[A-Z]*[\s,.-]+(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1]!];
    return mo ? ymd(fullYear(+m[2]!), mo) : null;
  }
  return null;
}
