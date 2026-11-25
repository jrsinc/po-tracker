import { AuthRequiredError, type TokenSet, type TokenStore } from './types';

/** Refreshes tokens with the identity provider. Implemented with expo-auth-session. */
export interface OAuthClient {
  refresh(refreshToken: string): Promise<TokenSet>;
}

/** Errors from the token endpoint that mean the refresh token is no longer usable. */
export class InvalidGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGrantError';
  }
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Holds the current token set, refreshes silently (offline_access) shortly before expiry and
 * makes concurrent callers share one refresh. Pure TypeScript: no Expo imports.
 */
export class TokenManager {
  private current: TokenSet | null | undefined;
  private refreshing: Promise<TokenSet> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly client: OAuthClient,
    private readonly now: () => number = Date.now,
  ) {}

  async hasSession(): Promise<boolean> {
    const t = await this.load();
    return !!t && (!!t.refreshToken || t.expiresAt > this.now());
  }

  async setTokens(tokens: TokenSet): Promise<void> {
    this.current = tokens;
    await this.store.save(tokens);
  }

  async clear(): Promise<void> {
    this.current = null;
    this.refreshing = null;
    await this.store.clear();
  }

  /** Returns a valid access token, refreshing if needed. Throws AuthRequiredError if signed out. */
  async getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
    const t = await this.load();
    if (!t) throw new AuthRequiredError();
    const fresh = t.accessToken && t.expiresAt - REFRESH_MARGIN_MS > this.now();
    if (fresh && !opts.forceRefresh) return t.accessToken;
    if (!t.refreshToken) {
      if (fresh) return t.accessToken;
      throw new AuthRequiredError('Your session has expired. Please sign in again.');
    }
    const refreshed = await this.refreshOnce(t.refreshToken);
    return refreshed.accessToken;
  }

  private async load(): Promise<TokenSet | null> {
    if (this.current === undefined) this.current = await this.store.load();
    return this.current;
  }

  private refreshOnce(refreshToken: string): Promise<TokenSet> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const next = await this.client.refresh(refreshToken);
          // Entra rotates refresh tokens; keep the old one if a new one is not returned.
          const merged: TokenSet = { ...next, refreshToken: next.refreshToken ?? refreshToken };
          await this.setTokens(merged);
          return merged;
        } catch (e) {
          if (e instanceof InvalidGrantError) {
            await this.clear();
            throw new AuthRequiredError('Your session has expired. Please sign in again.');
          }
          throw e;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }
}
