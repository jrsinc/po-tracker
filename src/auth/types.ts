export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
}

/** Persistent storage for tokens. Native: expo-secure-store. Web: localStorage. */
export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

export class AuthRequiredError extends Error {
  constructor(message = 'Please sign in again.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class AuthCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'AuthCancelledError';
  }
}
