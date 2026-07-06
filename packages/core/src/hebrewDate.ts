/**
 * תאריכים עבריים — על גבי Intl המובנה בדפדפן (לוח hebrew).
 * תואם לפורמט ציוני הדרך של המערכת הקיימת: { day, monthName }.
 */

export interface HebrewParts {
  day: number;
  monthName: string;
  year: number;
}

const fmt = new Intl.DateTimeFormat('he-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** המרת תאריך לועזי לחלקי תאריך עברי */
export function hebrewParts(date: Date): HebrewParts | null {
  if (isNaN(date.getTime())) return null;
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = parseInt(get('day'), 10);
  const year = parseInt(get('year'), 10);
  const monthName = get('month');
  if (!day || !monthName) return null;
  return { day, monthName, year };
}

/** תצוגה: "י״ב תמוז" — מספר עברי בסיסי ליום */
const HEB_DAYS = ['', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳', 'י׳',
  'י״א', 'י״ב', 'י״ג', 'י״ד', 'ט״ו', 'ט״ז', 'י״ז', 'י״ח', 'י״ט', 'כ׳',
  'כ״א', 'כ״ב', 'כ״ג', 'כ״ד', 'כ״ה', 'כ״ו', 'כ״ז', 'כ״ח', 'כ״ט', 'ל׳'];
export function formatHebrew(day: number, monthName: string): string {
  return `${HEB_DAYS[day] ?? day} ${monthName}`;
}

/** נרמול שם חודש להשוואה — גרסאות כתיב (חשון/חשוון/מרחשוון, גרשיים) */
export function normalizeMonth(name: string): string {
  return name
    .replace(/[׳'"״]/g, '')
    .replace(/^מר/, '')     // מרחשוון → חשוון
    .replace(/וו/g, 'ו')    // חשוון → חשון
    .trim();
}

/**
 * המופע הבא של תאריך עברי (יום+חודש) מהיום והלאה — סריקת ~800 ימים
 * (מכסה שנה מעוברת שבה החודש עשוי לא להופיע בשנה הקרובה).
 */
export function nextOccurrence(monthName: string, day: number, from: Date = new Date()): Date | null {
  const target = normalizeMonth(monthName);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i <= 800; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const h = hebrewParts(d);
    if (h && h.day === day && normalizeMonth(h.monthName) === target) return d;
  }
  return null;
}

/** ימים עד המופע הבא של ציון דרך עברי; null אם לא נמצא */
export function daysUntil(monthName: string, day: number, from: Date = new Date()): number | null {
  const next = nextOccurrence(monthName, day, from);
  if (!next) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((next.getTime() - start.getTime()) / 86400000);
}
