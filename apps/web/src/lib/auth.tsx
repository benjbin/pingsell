import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, errorMessage, getToken, onUnauthorized, setToken } from "./api";
import type { Account, AuthResponse, Usage, User } from "./types";

interface AuthCtx {
  account: Account | null;
  /** The signed-in person (several people can share an account). */
  user: User | null;
  /** Owner or admin: can manage the team, API keys and account settings. */
  canManage: boolean;
  usage: Usage | null;
  /** true while the initial /me check runs */
  initializing: boolean;
  /** Set when the session could not be verified because the API is unreachable (token is kept). */
  bootError: string | null;
  retryBoot: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Starts a session from an auth response (e.g. an accepted invitation). */
  adopt: (res: AuthResponse) => Promise<void>;
  setUser: (user: User) => void;
  setAccount: (account: Account) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [initializing, setInitializing] = useState<boolean>(() => !!getToken());
  const [bootError, setBootError] = useState<string | null>(null);

  const logout = useCallback(() => {
    setToken(null);
    setAccount(null);
    setUser(null);
    setUsage(null);
    setBootError(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api.me();
    setAccount(me.account);
    setUser(me.user ?? null);
    setUsage(me.usage);
  }, []);

  useEffect(() => onUnauthorized(logout), [logout]);

  const boot = useCallback(() => {
    if (!getToken()) {
      setInitializing(false);
      return;
    }
    setInitializing(true);
    setBootError(null);
    refresh()
      .catch((err: unknown) => {
        // Only an explicit auth failure ends the session; network errors keep the token.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) logout();
        else setBootError(errorMessage(err));
      })
      .finally(() => setInitializing(false));
  }, [refresh, logout]);

  useEffect(() => boot(), [boot]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.login({ email, password });
      setToken(res.token);
      setAccount(res.account);
      setUser(res.user);
      await refresh().catch(() => undefined);
    },
    [refresh],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api.auth.register({ name, email, password });
      setToken(res.token);
      setAccount(res.account);
      setUser(res.user);
      await refresh().catch(() => undefined);
    },
    [refresh],
  );

  const adopt = useCallback(
    async (res: AuthResponse) => {
      setToken(res.token);
      setAccount(res.account);
      setUser(res.user);
      await refresh().catch(() => undefined);
    },
    [refresh],
  );

  const canManage = !user || user.role !== "editor";
  const value = useMemo(
    () => ({ account, user, canManage, usage, initializing, bootError, retryBoot: boot, login, register, logout, refresh, adopt, setUser, setAccount }),
    [account, user, canManage, usage, initializing, bootError, boot, login, register, logout, refresh, adopt],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
