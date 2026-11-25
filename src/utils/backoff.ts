/** Exponential backoff with full jitter, honouring a server Retry-After when given. */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  opts: BackoffOptions = {},
): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 15 * 60 * 1000;
  const random = opts.random ?? Math.random;
  if (retryAfterMs !== undefined && retryAfterMs >= 0) return Math.min(retryAfterMs, max);
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  // Full jitter between 50% and 100% of the exponential delay.
  return Math.round(exp / 2 + (random() * exp) / 2);
}

/** Parses an HTTP Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
