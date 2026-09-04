import { useTheme } from './ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDay = theme === 'day';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDay ? 'Switch to dinner theme' : 'Switch to day theme'}
      title={isDay ? 'Switch to dinner theme' : 'Switch to day theme'}
    >
      {isDay ? '☀️' : '🌙'}
    </button>
  );
}
