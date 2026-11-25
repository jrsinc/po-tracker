import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { signIn as interactiveSignIn, tokenManager } from './authService';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: AuthStatus;
  signIn: () => Promise<void>;
  /** Marks the session as signed out (data clearing is done by AppServices.signOut). */
  markSignedOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    tokenManager
      .hasSession()
      .then((ok) => setStatus(ok ? 'signedIn' : 'signedOut'))
      .catch(() => setStatus('signedOut'));
  }, []);

  const signIn = useCallback(async () => {
    await interactiveSignIn();
    setStatus('signedIn');
  }, []);

  const markSignedOut = useCallback(() => setStatus('signedOut'), []);

  const value = useMemo(() => ({ status, signIn, markSignedOut }), [status, signIn, markSignedOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
