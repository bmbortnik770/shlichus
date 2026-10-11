import { describe, it, expect } from 'vitest';
import { computeToday, lastContact } from '../src/today.js';
import { parseLooseDate } from '../src/dates.js';
import { getAptScore } from '../src/scoring.js';
import { CONNECTORS, isConnectorActive, setConnector } from '../src/connectors.js';
import type { Db } from '../src/types.js';

// יום ראשון, ל׳ תשרי תשפ״ז
const NOW = new Date(2026, 9, 11, 9, 0);
const ago = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

function dbWith(apts: Record<string, unknown>[]): Db {
  return { meta: { lastModified: 0 }, 'ראובן 4': { info: {}, apts } } as unknown as Db;
}

describe('parseLooseDate', () => {
  it('פורמט ישראלי עם שעה (נשמר ע"י v2)', () => {
    const d = parseLooseDate('6.7.2026 14:30')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 6, 6, 14]);
  });
  it('ISO ותאריך עם לוכסנים', () => {
    expect(parseLooseDate('2026-07-06')!.getDate()).toBe(6);
    expect(parseLooseDate('06/07/2026')!.getMonth()).toBe(6);
  });
  it('ערכים לא תקינים → null', () => {
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate('לא תאריך')).toBeNull();
    expect(parseLooseDate(undefined)).toBeNull();
  });
  it('ניקוד הקשר סופר תיעוד בפורמט הישראלי (באג שתוקן)', () => {
    const d = new Date(Date.now() - 3 * 86400000);
    const he = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} 10:00`;
    expect(getAptScore({ interactions: [{ date: he, type: 'שיחה' }] })).toBe(30);
  });
});

describe('computeToday', () => {
  it('יארצייט ב-ב׳ חשוון (בעוד יומיים) → ראשון ברשימה ודחוף', () => {
    const db = dbWith([
      { name: 'כהן', interactions: [{ date: ago(200) }] },
      { name: 'לוי', interactions: [{ date: ago(10) }],
        milestones: [{ type: 'yahrzeit', label: 'יארצייט לאביו', day: 2, monthName: 'חשוון' }] },
    ]);
    const r = computeToday(db, { now: NOW });
    expect(r.items[0]!.name).toBe('משפחת לוי');
    expect(r.items[0]!.urgent).toBe(true);
    expect(r.items[0]!.reasons[0]!.kind).toBe('yahrzeit');
    expect(r.items[0]!.reasons[0]!.inDays).toBe(2);
    expect(r.items[0]!.reasons[0]!.detail).toContain('ב׳ חשוון');
    expect(r.items[0]!.reasons[0]!.detail).toContain('שלישי');
  });

  it('כתיב חודש שונה (מרחשוון) עדיין מזוהה', () => {
    const db = dbWith([{ name: 'א', milestones: [{ type: 'birthday', day: 3, monthName: 'מרחשוון' }], interactions: [{ date: ago(1) }] }]);
    expect(computeToday(db, { now: NOW }).items[0]!.reasons[0]!.inDays).toBe(3);
  });

  it('ל׳ תשרי = היום', () => {
    const db = dbWith([{ name: 'א', milestones: [{ type: 'birthday', day: 30, monthName: 'תשרי' }], interactions: [{ date: ago(1) }] }]);
    const it0 = computeToday(db, { now: NOW }).items[0]!;
    expect(it0.reasons[0]!.inDays).toBe(0);
    expect(it0.urgent).toBe(true);
  });

  it('משפחה שהתרחקה: מעל 60 יום ברשימה, מעל 90 דחוף', () => {
    const db = dbWith([
      { name: 'א', interactions: [{ date: ago(70) }] },
      { name: 'ב', interactions: [{ date: ago(120) }] },
      { name: 'ג', interactions: [{ date: ago(20) }] },
    ]);
    const r = computeToday(db, { now: NOW });
    expect(r.items.map((i) => i.name)).toEqual(['משפחת ב', 'משפחת א']);
    expect(r.items[0]!.urgent).toBe(true);
    expect(r.items[1]!.urgent).toBe(false);
  });

  it('תרומה בלי קשר אחריה → תודה; עם קשר אחריה → לא', () => {
    const db = dbWith([
      { name: 'א', donations: [{ date: ago(5), amount: 1800 }], interactions: [{ date: ago(20) }] },
      { name: 'ב', donations: [{ date: ago(5), amount: 500 }], interactions: [{ date: ago(2) }] },
    ]);
    const r = computeToday(db, { now: NOW });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.reasons[0]!.kind).toBe('thanks');
    expect(r.items[0]!.reasons[0]!.detail).toContain('1,800');
  });

  it('דירות בלי שם ודירות מחוקות לא נספרות', () => {
    const db = dbWith([{ num: '3' }, { name: 'א', deletedAt: 1 }, { name: 'ב' }]);
    const r = computeToday(db, { now: NOW });
    expect(r.pulse.total).toBe(1);
    expect(r.items[0]!.reasons[0]!.kind).toBe('never');
  });

  it('דופק הקהילה מחלק לפי זמן מהקשר האחרון', () => {
    const db = dbWith([
      { name: 'א', interactions: [{ date: ago(5) }] },
      { name: 'ב', interactions: [{ date: ago(45) }] },
      { name: 'ג', interactions: [{ date: ago(120) }] },
      { name: 'ד', interactions: [{ date: ago(400) }] },
      { name: 'ה' },
    ]);
    expect(computeToday(db, { now: NOW }).pulse).toEqual({ month: 1, quarter: 1, half: 1, older: 1, never: 1, total: 5 });
  });

  it('השבוע הקרוב: ציוני דרך + אירועים + משימות, ממוינים', () => {
    const db = dbWith([{ name: 'א', interactions: [{ date: ago(1) }], milestones: [{ type: 'birthday', label: 'יום הולדת לשרה', day: 3, monthName: 'חשוון' }] }]);
    db.meta!.events = [{ title: 'קידוש', date: '2026-10-17' }, { title: 'ישן', date: '2026-01-01' }];
    db.meta!.generalTasks = [{ text: 'להזמין אוכל', date: '2026-10-12', done: false }];
    const up = computeToday(db, { now: NOW }).upcoming;
    expect(up.map((u) => u.title)).toEqual(['להזמין אוכל', 'יום הולדת לשרה', 'קידוש']);
    expect(up[2]!.hebrew).toBe('ו׳ חשוון');
  });

  it('lastContact מוצא את המאוחר מבין פורמטים מעורבים', () => {
    expect(lastContact({ interactions: [{ date: '1.10.2026 10:00' }, { date: '2026-09-01' }] })!.getDate()).toBe(1);
  });
});

describe('connectors', () => {
  it('חינמי בלי חשבון — פעיל כברירת מחדל; Google דורש הפעלה', () => {
    expect(isConnectorActive({}, 'hebcal')).toBe(true);
    expect(isConnectorActive({}, 'wa-link')).toBe(true);
    expect(isConnectorActive({}, 'google-calendar')).toBe(false);
  });
  it('חיבור Pro לא פעיל בחבילה חינמית גם אם הופעל', () => {
    const connectors = setConnector({}, 'nedarim', { enabled: true });
    expect(isConnectorActive({ connectors }, 'nedarim')).toBe(false);
    expect(isConnectorActive({ connectors, plan: 'pro' }, 'nedarim')).toBe(true);
  });
  it('לכל חיבור מזהה ייחודי', () => {
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length);
  });
});
