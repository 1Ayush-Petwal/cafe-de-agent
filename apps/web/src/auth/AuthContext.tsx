import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../api/client';

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = 'cafe-de-app:user';

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? loadStoredUser() : null));

  const applyAuth = (result: { accessToken: string; user: AuthUser }) => {
    setToken(result.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      login: async (email, password) => applyAuth(await api.login(email, password)),
      signup: async (email, password) => applyAuth(await api.signup(email, password)),
      logout: () => {
        setToken(null);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
