/**
 * מועדי השנה — חגים, ראשי חודשים וימי חב"ד, מחושבים מקומית מ-Intl (בלי רשת).
 * משמש את מסך היום ("ראש חודש — לשלוח חודש טוב?") ואת לוח השבוע הקרוב.
 */
import { formatHebrew, hebrewParts, normalizeMonth } from './hebrewDate.js';

export interface Occasion {
  title: string;
  /** הצעת פעולה לקהילה, אם יש */
  suggestion?: string;
  /** הודעה מוכנה לשליחה, אם יש */
  message?: string;
  kind: 'holiday' | 'rosh-chodesh' | 'chabad' | 'fast';
}

interface Fixed { day: number; month: string; title: string; kind: Occasion['kind']; suggestion?: string; message?: string }

// מועדים קבועים (בארץ ישראל). חודש "אדר" מתאים גם לאדר ב׳ בשנה מעוברת — ראו adarFor.
const FIXED: Fixed[] = [
  { day: 1, month: 'תשרי', title: 'ראש השנה', kind: 'holiday' },
  { day: 2, month: 'תשרי', title: 'ראש השנה', kind: 'holiday' },
  { day: 10, month: 'תשרי', title: 'יום כיפור', kind: 'holiday' },
  { day: 15, month: 'תשרי', title: 'סוכות', kind: 'holiday' },
  { day: 22, month: 'תשרי', title: 'שמיני עצרת ושמחת תורה', kind: 'holiday' },
  { day: 19, month: 'כסלו', title: 'י״ט כסלו, ראש השנה לחסידות', kind: 'chabad',
    suggestion: 'הזדמנות להזמין את הקהילה להתוועדות.', message: 'לשנה טובה בלימוד ובדרכי החסידות! מזמינים אתכם להתוועדות י״ט כסלו.' },
  { day: 25, month: 'כסלו', title: 'חנוכה, נר ראשון', kind: 'holiday',
    suggestion: 'זמן טוב להדלקה משותפת ולחלוקת חנוכיות.', message: 'חנוכה שמח! מוזמנים להדלקת נרות משותפת.' },
  { day: 10, month: 'טבת', title: 'צום עשרה בטבת', kind: 'fast' },
  { day: 10, month: 'שבט', title: 'יו״ד שבט', kind: 'chabad' },
  { day: 15, month: 'שבט', title: 'ט״ו בשבט', kind: 'holiday' },
  { day: 14, month: 'אדר', title: 'פורים', kind: 'holiday',
    suggestion: 'זמן לתכנן קריאת מגילה ומשלוחי מנות למשפחות.', message: 'פורים שמח! קריאת המגילה בבית חב״ד.' },
  { day: 15, month: 'ניסן', title: 'פסח', kind: 'holiday' },
  { day: 11, month: 'ניסן', title: 'י״א ניסן, יום הולדת הרבי', kind: 'chabad' },
  { day: 18, month: 'אייר', title: 'ל״ג בעומר', kind: 'holiday' },
  { day: 6, month: 'סיון', title: 'שבועות', kind: 'holiday',
    suggestion: 'להזמין את המשפחות עם הילדים לשמוע עשרת הדיברות.', message: 'חג שבועות שמח! מוזמנים עם הילדים לשמוע עשרת הדיברות.' },
  { day: 3, month: 'תמוז', title: 'ג׳ תמוז', kind: 'chabad' },
  { day: 12, month: 'תמוז', title: 'י״ב תמוז, חג הגאולה', kind: 'chabad' },
  { day: 17, month: 'תמוז', title: 'צום י״ז בתמוז', kind: 'fast' },
  { day: 9, month: 'אב', title: 'תשעה באב', kind: 'fast' },
  { day: 18, month: 'אלול', title: 'ח״י אלול', kind: 'chabad' },
];

/** בשנה מעוברת פורים וכו' באדר ב׳; אדר א׳ לא מקבל את מועדי אדר */
function sameMonth(actual: string, target: string): boolean {
  const a = normalizeMonth(actual);
  const t = normalizeMonth(target);
  if (t === 'אדר') return a === 'אדר' || a === 'אדר ב';
  return a === t;
}

/** מועדים שחלים בתאריך נתון */
export function occasionsOn(date: Date): Occasion[] {
  const h = hebrewParts(date);
  if (!h) return [];
  const out: Occasion[] = [];
  for (const f of FIXED) {
    if (f.day === h.day && sameMonth(h.monthName, f.month)) {
      out.push({ title: f.title, kind: f.kind, suggestion: f.suggestion, message: f.message });
    }
  }
  // ראש חודש: א׳ בחודש (חוץ מתשרי), ול׳ בחודש הקודם
  const next = hebrewParts(new Date(date.getTime() + 86400000));
  const isRc1 = h.day === 1 && normalizeMonth(h.monthName) !== 'תשרי';
  const isRc30 = h.day === 30 && next?.day === 1 && normalizeMonth(next.monthName) !== 'תשרי';
  if (isRc1 || isRc30) {
    const month = isRc1 ? h.monthName : next!.monthName;
    out.push({
      title: `ראש חודש ${month}`,
      kind: 'rosh-chodesh',
      suggestion: 'הודעת "חודש טוב" לכל הקהילה היא נגיעה קטנה שמחזקת את הקשר.',
      message: `חודש ${month} טוב ומבורך! 🌙\nמאחלים לכם ולכל המשפחה חודש של בריאות, שמחה וברכה.\nבית חב״ד`,
    });
  }
  return out;
}

export interface DayOccasions { date: Date; inDays: number; hebrew: string; occasions: Occasion[] }

/** מועדים בימים הקרובים (כולל היום) */
export function upcomingOccasions(from: Date, days: number): DayOccasions[] {
  const out: DayOccasions[] = [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const occ = occasionsOn(d);
    if (!occ.length) continue;
    const h = hebrewParts(d);
    out.push({ date: d, inDays: i, hebrew: h ? formatHebrew(h.day, h.monthName) : '', occasions: occ });
  }
  return out;
}

/** "יום ראשון · ל׳ תשרי תשפ״ז" */
export function hebrewDateLine(date: Date): string {
  const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(date);
  const h = hebrewParts(date);
  if (!h) return weekday;
  return `${weekday} · ${formatHebrew(h.day, h.monthName)} ${hebrewYear(h.year)}`;
}

const LETTERS: [number, string][] = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];

/** 5787 → תשפ״ז */
export function hebrewYear(year: number): string {
  let n = year % 1000;
  let s = '';
  for (const [v, l] of LETTERS) {
    while (n >= v) {
      // ט״ו / ט״ז במקום י״ה / י״ו
      if (n === 15) { s += 'טו'; n = 0; break; }
      if (n === 16) { s += 'טז'; n = 0; break; }
      s += l; n -= v;
    }
  }
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
}
