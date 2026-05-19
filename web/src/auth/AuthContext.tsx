import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, AUTH_LOGOUT_EVENT, clearStoredSession, getStoredUser, storeSession } from "../api/client";
import type { User } from "../types";

type AuthContextValue = {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());

  useEffect(() => {
    const syncLogout = () => setUser(null);
    window.addEventListener(AUTH_LOGOUT_EVENT, syncLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, syncLogout);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    async login(username, password) {
      const res = await api.post("/auth/login", { username, password });
      storeSession(res.data.token, res.data.user);
      setUser(res.data.user);
    },
    logout() {
      clearStoredSession();
      setUser(null);
    }
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
