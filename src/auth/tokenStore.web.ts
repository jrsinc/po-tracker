import type { TokenSet, TokenStore } from './types';

/**
 * Web has no keychain. Tokens are kept in localStorage so a page reload does not force a new
 * sign-in. Entra issues SPA refresh tokens with a 24-hour lifetime, which limits exposure.
 */
const KEY = 'potracker.auth';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const tokenStore: TokenStore = {
  async load() {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenSet;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    storage()?.setItem(KEY, JSON.stringify(tokens));
  },
  async clear() {
    storage()?.removeItem(KEY);
  },
};
