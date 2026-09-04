import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { applyTheme, clockTheme, getOverride, resolveTheme, setOverride, type Theme } from './theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Re-checks the clock every minute so a session left open across the
// 06:00/17:00 boundary switches without a reload — unless the sun/moon
// toggle has set an override, which always wins.
const CLOCK_POLL_MS = 60_000;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const id = setInterval(() => {
      if (getOverride() === null) setTheme(clockTheme());
    }, CLOCK_POLL_MS);
    return () => clearInterval(id);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'day' ? 'dinner' : 'day';
    setOverride(next);
    setTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
