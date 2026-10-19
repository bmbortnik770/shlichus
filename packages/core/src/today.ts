/**
 * מנוע "היום" — מחליט את מי השליח צריך לפגוש/להתקשר אליו היום ולמה.
 * פונקציה טהורה מעל ה-Db: אין גישה לרשת או ל-DOM, ולכן נבדקת ביחידה.
 *
 * סיבות (לפי עדיפות): יארצייט קרוב · יום הולדת/נישואין/בר מצווה קרוב ·
 * תרומה שלא הודינו עליה · משפחה שהתרחקה · משפחה שעוד לא היה איתה קשר.
 */
import type { Apartment, Db } from './types.js';
import { buildingKeys, getBuilding, NO_ADDRESS_KEY } from './types.js';
import { liveApts } from './merge.js';
import { dateAlerts } from './lifecycle.js';
import { formatHebrew, hebrewParts, normalizeMonth } from './hebrewDate.js';
import { daysBetween, parseLooseDate } from './dates.js';

export type ReasonKind = 'yahrzeit' | 'birthday' | 'anniversary' | 'barmitzva' | 'occasion' | 'thanks' | 'lost' | 'never';

export interface TodayReason {
  kind: ReasonKind;
  /** תווית קצרה לצ'יפ: "יארצייט", "יום הולדת", "התרחקו" */
  label: string;
  /** משפט הסבר: "לאביו, ב׳ חשוון (יום שלישי)" */
  detail: string;
  /** לסיבות תאריכיות — בעוד כמה ימים (0 = היום) */
  inDays?: number;
}

export interface TodayItem {
  bldg: string;
  idx: number;
  name: string;
  address: string;
  reasons: TodayReason[];
  priority: number;
  urgent: boolean;
  lastContact: Date | null;
  daysSinceContact: number | null;
}

export interface UpcomingEvent {
  date: Date;
  inDays: number;
  /** "ב׳ חשוון" */
  hebrew: string;
  kind: ReasonKind | 'event' | 'task';
  title: string;
  bldg?: string;
  idx?: number;
}

export interface CommunityPulse {
  /** קשר ב-30 הימים האחרונים */
  month: number;
  /** 31–90 יום */
  quarter: number;
  /** 91–180 יום */
  half: number;
  /** מעל 180 יום */
  older: number;
  /** אין תיעוד קשר בכלל */
  never: number;
  total: number;
}

export interface TodayOptions {
  now?: Date;
  /** כמה ימים קדימה מחפשים תאריכים אישיים לרשימת היום */
  datesWindow?: number;
  /** כמה ימים קדימה מציגים בלוח "השבוע הקרוב" */
  upcomingWindow?: number;
  /** אחרי כמה ימים בלי קשר משפחה נחשבת "התרחקה" */
  lostAfterDays?: number;
  /** מעל כמה ימים בלי קשר זה דחוף */
  urgentLostDays?: number;
  /** כמה זמן אחרי תרומה עדיין מציעים להודות */
  thanksWindowDays?: number;
  /** כמה אנשים ברשימת היום (יכול לגדול כדי לפנות מקום לכל סוג תזכורת, עד פי 2) */
  limit?: number;
  /** מקומות מובטחים לכל סוג תזכורת — כדי שבר מצווה או יארצייט לא יידחקו ע"י משפחות שהתרחקו */
  perKind?: number;
}

export interface TodayResult {
  items: TodayItem[];
  upcoming: UpcomingEvent[];
  pulse: CommunityPulse;
}

const MS_LABELS: Record<string, { kind: ReasonKind; label: string }> = {
  yahrzeit: { kind: 'yahrzeit', label: 'יארצייט' },
  birthday: { kind: 'birthday', label: 'יום הולדת' },
  anniversary: { kind: 'anniversary', label: 'יום נישואין' },
  barmitzva: { kind: 'barmitzva', label: 'בר/בת מצווה' },
};

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "היום" / "מחר" / "יום שלישי" / "בעוד 9 ימים" */
export function relativeDay(inDays: number, date: Date): string {
  if (inDays === 0) return 'היום';
  if (inDays === 1) return 'מחר';
  if (inDays < 7) return `יום ${WEEKDAYS[date.getDay()]}`;
  return `בעוד ${inDays} ימים`;
}

/** תאריך הקשר האחרון של משפחה, או null אם אין תיעוד */
export function lastContact(apt: Apartment): Date | null {
  let max: Date | null = null;
  for (const log of apt.interactions ?? []) {
    const d = parseLooseDate(log.date);
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

export function displayName(apt: Apartment): string {
  if (apt.name?.trim()) return `משפחת ${apt.name.trim()}`;
  const parts = [apt.father, apt.mother].filter((x) => x?.trim());
  return parts.join(' ו') || '';
}

function addressOf(bldg: string, apt: Apartment): string {
  if (bldg === NO_ADDRESS_KEY) return 'ללא כתובת';
  return apt.num ? `${bldg}, דירה ${apt.num}` : bldg;
}

/**
 * טבלת הימים הקרובים: מפתח "יום|חודש-מנורמל" → היסט בימים.
 * חישוב Intl אחד לכל יום בחלון, במקום סריקה של מאות ימים לכל ציון דרך.
 */
function hebrewWindow(now: Date, days: number) {
  const byKey = new Map<string, number>();
  const dates: { date: Date; hebrew: string }[] = [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const h = hebrewParts(d);
    dates.push({ date: d, hebrew: h ? formatHebrew(h.day, h.monthName) : '' });
    if (!h) continue;
    const key = `${h.day}|${normalizeMonth(h.monthName)}`;
    if (!byKey.has(key)) byKey.set(key, i);
    // יום ל׳ שלא קיים בחודש חסר — מציינים ביום הראשון של החודש הבא (המנהג המקובל ליארצייט)
    if (h.day === 1 && i > 0) {
      const prev = hebrewParts(new Date(d.getTime() - 86400000));
      if (prev && prev.day === 29) {
        const k30 = `30|${normalizeMonth(prev.monthName)}`;
        if (!byKey.has(k30)) byKey.set(k30, i);
      }
    }
  }
  return { byKey, dates };
}

interface MilestoneHit { kind: ReasonKind; label: string; title: string; inDays: number }

function milestoneHits(apt: Apartment, win: ReturnType<typeof hebrewWindow>, now: Date, maxDays: number): MilestoneHit[] {
  const out: MilestoneHit[] = [];
  for (const raw of apt.milestones ?? []) {
    const m = raw as Record<string, unknown>;
    const type = String(m.type ?? 'other');
    const meta = MS_LABELS[type] ?? { kind: 'occasion' as ReasonKind, label: String(m.label ?? 'אירוע') };
    const title = String(m.label ?? meta.label);
    const day = Number(m.day) || 0;
    const month = String(m.monthName ?? '');
    let inDays: number | undefined;

    if (day && month && m.recurring !== false) {
      inDays = win.byKey.get(`${day}|${normalizeMonth(month)}`);
    } else {
      const g = parseLooseDate(m.gregDate);
      if (g) {
        const diff = daysBetween(now, g);
        if (diff >= 0) inDays = diff;
      }
    }
    if (inDays !== undefined && inDays <= maxDays) out.push({ kind: meta.kind, label: meta.label, title, inDays });
  }
  return out;
}

export function computeToday(db: Db, opts: TodayOptions = {}): TodayResult {
  const now = opts.now ?? new Date();
  const datesWindow = opts.datesWindow ?? 7;
  const upcomingWindow = opts.upcomingWindow ?? 7;
  const lostAfter = opts.lostAfterDays ?? 60;
  const urgentLost = opts.urgentLostDays ?? 90;
  const thanksWindow = opts.thanksWindowDays ?? 30;
  const limit = opts.limit ?? 10;

  const win = hebrewWindow(now, Math.max(datesWindow, upcomingWindow));
  const items: TodayItem[] = [];
  const upcoming: UpcomingEvent[] = [];
  const pulse: CommunityPulse = { month: 0, quarter: 0, half: 0, older: 0, never: 0, total: 0 };

  for (const bldg of buildingKeys(db)) {
    const entry = getBuilding(db, bldg);
    if (!entry) continue;
    entry.apts.forEach((apt, idx) => {
      if (apt.deletedAt) return;
      const name = displayName(apt);
      if (!name) return; // דירה בלי שם — יחידה במיפוי, לא משפחה מוכרת

      const last = lastContact(apt);
      const since = last ? daysBetween(last, now) : null;
      pulse.total++;
      if (since === null) pulse.never++;
      else if (since <= 30) pulse.month++;
      else if (since <= 90) pulse.quarter++;
      else if (since <= 180) pulse.half++;
      else pulse.older++;

      const reasons: TodayReason[] = [];
      let priority = 0;
      let urgent = false;

      for (const hit of milestoneHits(apt, win, now, Math.max(datesWindow, upcomingWindow))) {
        const slot = win.dates[hit.inDays];
        if (!slot) continue;
        if (hit.inDays <= upcomingWindow) {
          upcoming.push({ date: slot.date, inDays: hit.inDays, hebrew: slot.hebrew, kind: hit.kind, title: hit.title, bldg, idx });
        }
        if (hit.inDays > datesWindow) continue;
        const when = `${slot.hebrew} (${relativeDay(hit.inDays, slot.date)})`;
        reasons.push({ kind: hit.kind, label: hit.label, detail: `${hit.title}, ${when}`, inDays: hit.inDays });
        const base = hit.kind === 'yahrzeit' ? 100 : hit.kind === 'occasion' ? 55 : 75;
        priority = Math.max(priority, base - hit.inDays * 4);
        if (hit.kind === 'yahrzeit' && hit.inDays <= 3) urgent = true;
        if (hit.inDays === 0) urgent = true;
      }

      // תאריכי לידה (ילדים והורים), בר/בת מצווה מתקרבים, וימי שנה לאירועי חיים
      for (const a of dateAlerts(apt, now)) {
        const window = a.kind === 'barmitzva' ? 60 : a.kind === 'life' ? 14 : datesWindow;
        if (a.inDays > window) continue;
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + a.inDays, 12);
        const kind: ReasonKind = a.kind === 'life' ? 'occasion' : a.kind;
        if (a.inDays <= upcomingWindow) upcoming.push({ date, inDays: a.inDays, hebrew: win.dates[a.inDays]?.hebrew ?? '', kind, title: `${a.title} · ${name}`, bldg, idx });
        reasons.push({ kind, label: a.kind === 'barmitzva' ? 'בר/בת מצווה' : a.kind === 'life' ? 'יום שנה' : 'יום הולדת', detail: `${a.title}, ${relativeDay(a.inDays, date)}`, inDays: a.inDays });
        priority = Math.max(priority, (a.kind === 'barmitzva' ? 70 : 75) - Math.min(a.inDays, 30));
        if (a.inDays === 0 || (a.kind === 'barmitzva' && a.inDays <= 7)) urgent = true;
      }

      // תרומה אחרונה שאחריה לא תועד שום קשר
      let lastDonation: { date: Date; amount: number } | null = null;
      for (const d of apt.donations ?? []) {
        const dt = parseLooseDate(d.date);
        if (dt && (!lastDonation || dt > lastDonation.date)) lastDonation = { date: dt, amount: Number(d.amount) || 0 };
      }
      if (lastDonation) {
        const age = daysBetween(lastDonation.date, now);
        if (age >= 0 && age <= thanksWindow && (!last || last < lastDonation.date)) {
          const sum = lastDonation.amount ? `${lastDonation.amount.toLocaleString('he-IL')} ₪ ` : '';
          reasons.push({ kind: 'thanks', label: 'תודה על תרומה', detail: `תרמו ${sum}לפני ${age} ימים, ועוד לא הודינו` });
          priority = Math.max(priority, 65);
        }
      }

      if (since !== null && since >= lostAfter) {
        reasons.push({ kind: 'lost', label: 'התרחקו', detail: `לא היה קשר ${since} ימים` });
        priority = Math.max(priority, 40 + Math.min(since, 365) / 10);
        if (since >= urgentLost) urgent = true;
      } else if (since === null && reasons.length === 0) {
        reasons.push({ kind: 'never', label: 'עוד לא הכרנו', detail: 'אין תיעוד קשר עם המשפחה' });
        priority = 20;
      }

      if (reasons.length) {
        items.push({ bldg, idx, name, address: addressOf(bldg, apt), reasons, priority, urgent, lastContact: last, daysSinceContact: since });
      }
    });
  }

  // אירועי קהילה ומשימות כלליות עם תאריך
  for (const ev of (db.meta?.events ?? []) as Record<string, unknown>[]) {
    if (ev.cancelled) continue;
    const d = parseLooseDate(ev.date);
    if (!d) continue;
    const inDays = daysBetween(now, d);
    if (inDays < 0 || inDays > upcomingWindow) continue;
    upcoming.push({ date: d, inDays, hebrew: win.dates[inDays]?.hebrew ?? '', kind: 'event', title: String(ev.title ?? ev.name ?? 'אירוע') });
  }
  for (const t of (db.meta?.generalTasks ?? []) as Record<string, unknown>[]) {
    if (t.done) continue;
    const d = parseLooseDate(t.date ?? t.due);
    if (!d) continue;
    const inDays = daysBetween(now, d);
    if (inDays < 0 || inDays > upcomingWindow) continue;
    upcoming.push({ date: d, inDays, hebrew: win.dates[inDays]?.hebrew ?? '', kind: 'task', title: String(t.text ?? 'משימה') });
  }

  items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.priority - a.priority || a.name.localeCompare(b.name, 'he'));
  upcoming.sort((a, b) => a.inDays - b.inDays);
  return { items: pickItems(items, limit, opts.perKind ?? 3), upcoming, pulse };
}

/**
 * בחירת הרשימה: קודם מקומות מובטחים לכל סוג תזכורת (לפי סדר העדיפות), ואז השלמה עד המכסה.
 * הסדר הסופי נשמר כמו במיון. התקרה: פי 2 מהמכסה.
 */
function pickItems(sorted: TodayItem[], limit: number, perKind: number): TodayItem[] {
  const picked = new Set<TodayItem>();
  const used = new Map<ReasonKind, number>();
  for (const it of sorted) {
    if (picked.size >= limit * 2) break;
    const r = it.reasons.find((x) => (used.get(x.kind) ?? 0) < perKind);
    if (!r) continue;
    picked.add(it);
    for (const x of it.reasons) used.set(x.kind, (used.get(x.kind) ?? 0) + 1);
  }
  for (const it of sorted) { if (picked.size >= limit) break; picked.add(it); }
  return sorted.filter((it) => picked.has(it));
}
