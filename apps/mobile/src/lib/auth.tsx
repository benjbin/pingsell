import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiClient, DEFAULT_API_URL, normalizeApiUrl } from './api';
import { getItem, removeItem, setItem, STORAGE_KEYS } from './storage';
import { t } from './i18n';
import type { Account } from './types';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  apiUrl: string;
  lastEmail: string;
  account: Account | null;
  api: ApiClient;
  signIn(apiUrl: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setAccount(account: Account): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState<string | null>(null);
  const [lastEmail, setLastEmail] = useState('');
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedToken, storedUrl, storedEmail] = await Promise.all([
        getItem(STORAGE_KEYS.token),
        getItem(STORAGE_KEYS.apiUrl),
        getItem(STORAGE_KEYS.email),
      ]);
      if (cancelled) return;
      if (storedUrl) setApiUrl(storedUrl);
      if (storedEmail) setLastEmail(storedEmail);
      setToken(storedToken);
      setStatus(storedToken ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await removeItem(STORAGE_KEYS.token);
    setToken(null);
    setAccount(null);
    setStatus('signedOut');
  }, []);

  const signIn = useCallback(async (rawUrl: string, email: string, password: string) => {
    const url = normalizeApiUrl(rawUrl);
    const res = await new ApiClient({ baseUrl: url }).login(email.trim(), password);
    await Promise.all([
      setItem(STORAGE_KEYS.token, res.token),
      setItem(STORAGE_KEYS.apiUrl, url),
      setItem(STORAGE_KEYS.email, email.trim()),
    ]);
    setApiUrl(url);
    setLastEmail(email.trim());
    setToken(res.token);
    setAccount(res.account);
    setStatus('signedIn');
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiUrl,
        token,
        onUnauthorized: () => {
          void signOut();
        },
      }),
    [apiUrl, token, signOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, apiUrl, lastEmail, account, api, signIn, signOut, setAccount }),
    [status, apiUrl, lastEmail, account, api, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error(t('useAuth doit être utilisé dans <AuthProvider>', 'useAuth must be used within <AuthProvider>'));
  return ctx;
}
