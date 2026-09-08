import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, PublicProfile } from "../lib/api";

type AuthState = {
  user: PublicProfile | null;
  loading: boolean;
  error: string | null;
  register: (username: string, password: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function extractError(err: any): string {
  return err?.response?.data?.error || "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<PublicProfile>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const { data } = await api.post<PublicProfile>("/auth/register", { username, password });
      setUser(data);
      return true;
    } catch (err) {
      setError(extractError(err));
      return false;
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const { data } = await api.post<PublicProfile>("/auth/login", { username, password });
      setUser(data);
      return true;
    } catch (err) {
      setError(extractError(err));
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, register, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
