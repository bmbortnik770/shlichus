import { isDark } from './themeMode';
/**
 * צבע המערכת — ערכות מוכנות עם גרסה לבהיר ולכהה, כך שהניגודיות נשמרת בשני המצבים.
 * נשמר ב-__SETTINGS__.webAccent (נפרד מ-themeColor של המערכת הקיימת).
 */
export const ACCENTS = [
  { id: 'teal', name: 'ירוק כהה', light: ['#0e6b64', '#e0f0ed'], dark: ['#4fc1b4', '#173431'] },
  { id: 'blue', name: 'כחול', light: ['#1d5fa8', '#e3edf9'], dark: ['#7fb2e6', '#1a2a3b'] },
  { id: 'indigo', name: 'סגול', light: ['#4b3f9e', '#ebe8f8'], dark: ['#b2a3e0', '#262236'] },
  { id: 'wine', name: 'בורדו', light: ['#9b2c4a', '#f7e6eb'], dark: ['#f08aa5', '#3a1c25'] },
  { id: 'amber', name: 'ענבר', light: ['#8a5a00', '#f8eedb'], dark: ['#e2b25c', '#33291a'] },
] as const;

export function applyAccent(id: string | undefined): void {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  const dark = isDark();
  const [accent, soft] = dark ? a.dark : a.light;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-soft', soft);
}
