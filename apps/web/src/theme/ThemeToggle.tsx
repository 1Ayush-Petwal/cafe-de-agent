import { useTheme } from './ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDay = theme === 'day';
  const label = isDay ? 'Switch to dinner theme' : 'Switch to day theme';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {isDay ? '☀️' : '🌙'}
    </button>
  );
}
