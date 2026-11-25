import { computeBackoffMs, parseRetryAfter, sleep as defaultSleep } from '../utils/backoff';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'GraphError';
  }

  get isRetryable(): boolean {
    return isRetryableStatus(this.status);
  }
}

/** The request never reached Graph (offline, DNS, TLS, timeout). Always retryable. */
export class NetworkError extends Error {
  constructor(message: string, public readonly original?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isRetryableError(e: unknown): boolean {
  return e instanceof NetworkError || (e instanceof GraphError && e.isRetryable);
}

export type RawBody = Uint8Array | ArrayBuffer | Blob;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body */
  body?: unknown;
  /** Binary body (file content). */
  rawBody?: RawBody;
  headers?: Record<string, string>;
  /** Send the bearer token (default true). Upload-session URLs must NOT get it. */
  auth?: boolean;
  /** Max automatic retries for 429/5xx/network errors (default 3). */
  retries?: number;
}

export interface GraphHttpDeps {
  getToken: (opts?: { forceRefresh?: boolean }) => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Retry-After longer than this is not waited for in-request; the error is thrown instead. */
  maxInlineWaitMs?: number;
}

/** Small typed fetch client for Microsoft Graph v1.0. */
export class GraphHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: GraphHttpDeps) {
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** Performs a request and parses the JSON response (undefined for 204/empty bodies). */
  async request<T>(pathOrUrl: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.send(pathOrUrl, opts);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async send(pathOrUrl: string, opts: RequestOptions = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_BASE + pathOrUrl;
    const maxRetries = opts.retries ?? 3;
    const maxInline = this.deps.maxInlineWaitMs ?? 30_000;
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
      if (opts.auth !== false) {
        headers.Authorization = `Bearer ${await this.deps.getToken({ forceRefresh: refreshed })}`;
      }
      let body: BodyInit | undefined;
      if (opts.rawBody !== undefined) {
        body = opts.rawBody as BodyInit;
      } else if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: opts.method ?? 'GET', headers, body });
      } catch (e) {
        const err = new NetworkError(e instanceof Error ? e.message : 'Network request failed', e);
        if (attempt < maxRetries) {
          await this.sleep(computeBackoffMs(attempt, undefined, { random: this.deps.random }));
          continue;
        }
        throw err;
      }

      if (res.ok) return res;

      if (res.status === 401 && opts.auth !== false && !refreshed) {
        refreshed = true;
        continue;
      }

      const error = await toGraphError(res);
      if (error.isRetryable && attempt < maxRetries) {
        const wait = computeBackoffMs(attempt, error.retryAfterMs, { random: this.deps.random });
        if (wait <= maxInline) {
          await this.sleep(wait);
          continue;
        }
      }
      throw error;
    }
  }
}

async function toGraphError(res: Response): Promise<GraphError> {
  let body: unknown;
  let code = `http_${res.status}`;
  let message = `${res.status} ${res.statusText}`;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : undefined;
    const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    if (err?.code) code = err.code;
    if (err?.message) message = err.message;
  } catch {
    // non-JSON error body
  }
  return new GraphError(res.status, code, message, parseRetryAfter(res.headers.get('Retry-After')), body);
}

/** Encodes a drive path segment by segment (keeps the slashes). */
export function encodeDrivePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

/** OData string literal escaping. */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
