/**
 * פענוח תאריכים סלחני — בנתונים יש כמה פורמטים במקביל:
 * ISO מהישן ("2026-07-06", "2026-07-06T10:00:00Z") ו-he-IL מ-v2 ("6.7.2026 14:30").
 * new Date() לבד לא מבין את הפורמט הישראלי, ולכן תיעודים כאלה "נעלמו" מהניקוד.
 */
export function parseLooseDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return isNaN(value) ? null : new Date(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();

  // יום.חודש.שנה או יום/חודש/שנה, אופציונלית עם שעה
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, d = '', mo = '', y = '', hh, mm] = m;
    const date = new Date(+y, +mo - 1, +d, hh ? +hh : 12, mm ? +mm : 0);
    return isNaN(date.getTime()) ? null : date;
  }

  // תאריך ISO בלבד — צהריים מקומי, כדי שלא יזלוג ליום הקודם בגלל אזור זמן
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const date = new Date(s + 'T12:00:00');
    return isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(s);
  return isNaN(date.getTime()) ? null : date;
}

/** ימים שלמים בין שני תאריכים לפי יום קלנדרי מקומי (b - a) */
export function daysBetween(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / 86400000);
}
