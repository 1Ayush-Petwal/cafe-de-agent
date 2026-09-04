export type Theme = 'day' | 'dinner';

const OVERRIDE_KEY = 'kaforia-theme-override';
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 17;
const THEME_COLOR: Record<Theme, string> = {
  day: '#faf7f2',
  dinner: '#1c1108',
};

export function clockTheme(now: Date = new Date()): Theme {
  const hour = now.getHours();
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? 'day' : 'dinner';
}

export function getOverride(): Theme | null {
  const stored = localStorage.getItem(OVERRIDE_KEY);
  return stored === 'day' || stored === 'dinner' ? stored : null;
}

export function setOverride(theme: Theme): void {
  localStorage.setItem(OVERRIDE_KEY, theme);
}

export function resolveTheme(): Theme {
  return getOverride() ?? clockTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}
