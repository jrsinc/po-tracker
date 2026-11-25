import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getConfig } from '../config/env';
import { tokenStore } from './tokenStore';
import { InvalidGrantError, TokenManager, type OAuthClient } from './tokenManager';
import { AuthCancelledError, type TokenSet } from './types';

// Web: completes the sign-in popup when it is redirected back to this origin.
WebBrowser.maybeCompleteAuthSession();

export const APP_SCHEME = 'potracker';

export function getRedirectUri(): string {
  // Native: potracker://auth  |  Web: https://<origin>/auth
  return AuthSession.makeRedirectUri({ scheme: APP_SCHEME, path: 'auth' });
}

function authority(): string {
  return `https://login.microsoftonline.com/${getConfig().tenantId}/v2.0`;
}

let discoveryPromise: Promise<AuthSession.DiscoveryDocument> | null = null;
function discovery(): Promise<AuthSession.DiscoveryDocument> {
  if (!discoveryPromise) {
    discoveryPromise = AuthSession.fetchDiscoveryAsync(authority()).catch((e: unknown) => {
      discoveryPromise = null;
      throw e;
    });
  }
  return discoveryPromise;
}

function toTokenSet(r: AuthSession.TokenResponse): TokenSet {
  const issuedAt = (r.issuedAt ?? Math.floor(Date.now() / 1000)) * 1000;
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    idToken: r.idToken,
    expiresAt: issuedAt + (r.expiresIn ?? 3600) * 1000,
  };
}

const oauthClient: OAuthClient = {
  async refresh(refreshToken) {
    const cfg = getConfig();
    try {
      const res = await AuthSession.refreshAsync(
        { clientId: cfg.clientId, refreshToken, scopes: cfg.scopes },
        await discovery(),
      );
      return toTokenSet(res);
    } catch (e: unknown) {
      const code = (e as { code?: string; params?: { error?: string } }).code ??
        (e as { params?: { error?: string } }).params?.error;
      if (code === 'invalid_grant' || code === 'interaction_required') {
        throw new InvalidGrantError(String((e as Error).message ?? code));
      }
      throw e;
    }
  },
};

export const tokenManager = new TokenManager(tokenStore, oauthClient);

let prepared: AuthSession.AuthRequest | null = null;

/**
 * Builds the authorization request ahead of time. On web the popup must open directly from the
 * click handler, so the sign-in screen calls this on mount and signIn() only opens the prompt.
 */
export async function prepareSignIn(): Promise<void> {
  const cfg = getConfig();
  const request = new AuthSession.AuthRequest({
    clientId: cfg.clientId,
    scopes: cfg.scopes,
    redirectUri: getRedirectUri(),
    usePKCE: true,
    prompt: AuthSession.Prompt.SelectAccount,
  });
  await request.makeAuthUrlAsync(await discovery());
  prepared = request;
}

/** Interactive Microsoft sign-in: authorization code flow with PKCE (public client). */
export async function signIn(): Promise<void> {
  const cfg = getConfig();
  if (!prepared) await prepareSignIn();
  const request = prepared!;
  prepared = null;
  const doc = await discovery();
  const result = await request.promptAsync(doc);
  if (result.type === 'cancel' || result.type === 'dismiss' || result.type === 'locked') {
    throw new AuthCancelledError();
  }
  if (result.type !== 'success') {
    const params = 'params' in result ? (result.params as Record<string, string>) : {};
    throw new Error(params.error_description ?? params.error ?? 'Sign-in failed.');
  }
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: cfg.clientId,
      code: result.params.code ?? '',
      redirectUri: request.redirectUri,
      scopes: cfg.scopes,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    doc,
  );
  await tokenManager.setTokens(toTokenSet(tokens));
}

export async function signOutTokens(): Promise<void> {
  await tokenManager.clear();
  if (Platform.OS === 'web') prepared = null;
}
