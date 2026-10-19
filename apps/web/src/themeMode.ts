/** מצב תצוגה: אוטומטי (לפי המכשיר), בהיר או כהה — נשמר במכשיר */
export type ThemeMode = 'auto' | 'light' | 'dark';
const KEY = 'shlichus_theme';

export function getThemeMode(): ThemeMode {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}

export function applyThemeMode(mode: ThemeMode = getThemeMode()): void {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
}

export function setThemeMode(mode: ThemeMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* */ }
  applyThemeMode(mode);
}

/** האם התצוגה כרגע כהה (בחירה ידנית, או לפי המכשיר) */
export function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
