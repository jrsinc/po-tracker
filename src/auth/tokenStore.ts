import * as SecureStore from 'expo-secure-store';
import type { TokenSet, TokenStore } from './types';

/**
 * Tokens are split across keys because some iOS versions reject keychain values over ~2 KB
 * and Microsoft refresh tokens can be large. AFTER_FIRST_UNLOCK lets the background sync task
 * read them while the phone is locked.
 */
const KEYS = { access: 'auth.access', refresh: 'auth.refresh', meta: 'auth.meta' } as const;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const tokenStore: TokenStore = {
  async load() {
    const [access, refresh, meta] = await Promise.all([
      SecureStore.getItemAsync(KEYS.access, OPTIONS),
      SecureStore.getItemAsync(KEYS.refresh, OPTIONS),
      SecureStore.getItemAsync(KEYS.meta, OPTIONS),
    ]);
    if (!access && !refresh) return null;
    const parsed = meta ? (JSON.parse(meta) as { expiresAt: number }) : { expiresAt: 0 };
    return {
      accessToken: access ?? '',
      refreshToken: refresh ?? undefined,
      expiresAt: parsed.expiresAt,
    } satisfies TokenSet;
  },
  async save(tokens) {
    await SecureStore.setItemAsync(KEYS.access, tokens.accessToken, OPTIONS);
    if (tokens.refreshToken) {
      await SecureStore.setItemAsync(KEYS.refresh, tokens.refreshToken, OPTIONS);
    }
    await SecureStore.setItemAsync(KEYS.meta, JSON.stringify({ expiresAt: tokens.expiresAt }), OPTIONS);
  },
  async clear() {
    await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k, OPTIONS)));
  },
};
