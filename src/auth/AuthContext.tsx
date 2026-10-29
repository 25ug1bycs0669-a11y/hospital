import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { api } from "../lib/api";
import type { User } from "../types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.me()
      .then(({ user: current }) => { if (active) setUser(current); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const response = await api.login(email, password);
      setUser(response.user);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to sign in.";
      setError(message);
      throw reason;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, error, login, logout }), [user, loading, error, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}