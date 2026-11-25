/**
 * Single source of runtime configuration. Values come from EXPO_PUBLIC_* environment
 * variables, which Expo inlines at build time (see .env.example). Nothing secret lives here:
 * the app is a public client (PKCE, no client secret).
 */

export interface AppConfig {
  tenantId: string;
  clientId: string;
  /** e.g. jrsllc1.sharepoint.com */
  siteHost: string;
  /** e.g. /sites/jrsllc */
  sitePath: string;
  /** List display name */
  listName: string;
  /** Document library display name for PO documents */
  libraryName: string;
  /** Folder inside the library that contains per-PO folders ('' = library root) */
  baseFolder: string;
  /** IANA time zone of the SharePoint site, used for date-only columns */
  siteTimeZone: string;
  scopes: string[];
}

export const GRAPH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Sites.ReadWrite.All',
  'Files.ReadWrite.All',
];

export type RawEnv = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing configuration: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    this.name = 'ConfigError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}

/** Pure parser so it can be unit tested. */
export function parseConfig(env: RawEnv): AppConfig {
  const get = (k: string) => (env[k] ?? '').trim();
  const missing: string[] = [];
  const required = (k: string) => {
    const v = get(k);
    if (!v) missing.push(k);
    return v;
  };

  const tenantId = required('EXPO_PUBLIC_TENANT_ID');
  const clientId = required('EXPO_PUBLIC_CLIENT_ID');
  const siteHost = required('EXPO_PUBLIC_SP_HOST');
  const sitePath = required('EXPO_PUBLIC_SP_SITE_PATH');
  const listName = required('EXPO_PUBLIC_SP_LIST_NAME');
  const libraryName = required('EXPO_PUBLIC_SP_LIBRARY_NAME');
  if (missing.length) throw new ConfigError(missing);

  if (!GUID.test(clientId) || /^0{8}-/.test(clientId)) {
    throw new ConfigError(['EXPO_PUBLIC_CLIENT_ID (must be the app registration GUID)']);
  }
  if (!GUID.test(tenantId) && !tenantId.includes('.')) {
    throw new ConfigError(['EXPO_PUBLIC_TENANT_ID (GUID or verified domain)']);
  }

  return {
    tenantId,
    clientId,
    siteHost: siteHost.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    sitePath: '/' + trimSlashes(sitePath),
    listName,
    libraryName,
    baseFolder: trimSlashes(get('EXPO_PUBLIC_SP_BASE_FOLDER')),
    siteTimeZone: get('EXPO_PUBLIC_SP_TIME_ZONE') || 'America/Los_Angeles',
    scopes: GRAPH_SCOPES,
  };
}

/**
 * EXPO_PUBLIC_* variables must be referenced literally so Metro can inline them.
 */
function readEnv(): RawEnv {
  return {
    EXPO_PUBLIC_TENANT_ID: process.env.EXPO_PUBLIC_TENANT_ID,
    EXPO_PUBLIC_CLIENT_ID: process.env.EXPO_PUBLIC_CLIENT_ID,
    EXPO_PUBLIC_SP_HOST: process.env.EXPO_PUBLIC_SP_HOST,
    EXPO_PUBLIC_SP_SITE_PATH: process.env.EXPO_PUBLIC_SP_SITE_PATH,
    EXPO_PUBLIC_SP_LIST_NAME: process.env.EXPO_PUBLIC_SP_LIST_NAME,
    EXPO_PUBLIC_SP_LIBRARY_NAME: process.env.EXPO_PUBLIC_SP_LIBRARY_NAME,
    EXPO_PUBLIC_SP_BASE_FOLDER: process.env.EXPO_PUBLIC_SP_BASE_FOLDER,
    EXPO_PUBLIC_SP_TIME_ZONE: process.env.EXPO_PUBLIC_SP_TIME_ZONE,
  };
}

let cached: AppConfig | null = null;
let cachedError: ConfigError | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    cached = parseConfig(readEnv());
    return cached;
  } catch (e) {
    if (e instanceof ConfigError) cachedError = e;
    throw e;
  }
}

/** Returns the config error (if any) without throwing; used by the sign-in screen. */
export function getConfigError(): ConfigError | null {
  try {
    getConfig();
    return null;
  } catch (e) {
    return e instanceof ConfigError ? e : new ConfigError([String(e)]);
  }
}
