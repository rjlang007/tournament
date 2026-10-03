import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { api, PublicProfile } from "../lib/api";

type AuthState = {
  user: PublicProfile | null;
  loading: boolean;
  error: string | null;
  register: (username: string, password: string, role: "ADMIN" | "PLAYER") => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

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

  const register = useCallback(async (username: string, password: string, role: "ADMIN" | "PLAYER") => {
    setError(null);
    try {
      const { data } = await api.post<PublicProfile>("/auth/register", { username, password, role });
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
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore logout failures; the UI should still clear the local session.
    }
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;

    let timeoutId: number | undefined;
    const resetTimer = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void logout();
      }, INACTIVITY_TIMEOUT_MS);
    };

    const activityEvents = ["mousemove", "keydown", "click", "touchstart", "scroll", "pointerdown"];
    resetTimer();
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [user, logout]);

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
