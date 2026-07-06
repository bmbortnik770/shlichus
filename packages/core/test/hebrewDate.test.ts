import { describe, it, expect } from 'vitest';
import { hebrewParts, nextOccurrence, daysUntil, normalizeMonth, formatHebrew } from '../src/hebrewDate.js';

describe('hebrewParts — המרה לועזי→עברי', () => {
  it('י"ב תמוז תשפ"ו הוא 27.6.2026', () => {
    // תאריך ידוע: י"ב תמוז (חג הגאולה) תשפ"ו
    const h = hebrewParts(new Date('2026-06-27T12:00:00'));
    expect(h).not.toBeNull();
    expect(h!.day).toBe(12);
    expect(normalizeMonth(h!.monthName)).toBe('תמוז');
  });

  it('ראש השנה תשפ"ז — א׳ תשרי ב-12.9.2026', () => {
    const h = hebrewParts(new Date('2026-09-12T12:00:00'));
    expect(h!.day).toBe(1);
    expect(normalizeMonth(h!.monthName)).toBe('תשרי');
  });

  it('תאריך לא תקין → null', () => {
    expect(hebrewParts(new Date('not-a-date'))).toBeNull();
  });
});

describe('nextOccurrence — המופע הבא של תאריך עברי', () => {
  it('מ-1.7.2026 (ט"ז תמוז) — י"ב תמוז הבא הוא בשנה הבאה', () => {
    const next = nextOccurrence('תמוז', 12, new Date('2026-07-01T12:00:00'));
    expect(next).not.toBeNull();
    const h = hebrewParts(next!);
    expect(h!.day).toBe(12);
    expect(normalizeMonth(h!.monthName)).toBe('תמוז');
    expect(next!.getTime()).toBeGreaterThan(new Date('2027-01-01').getTime());
  });

  it('התאריך של היום עצמו נחשב המופע הבא (0 ימים)', () => {
    const today = new Date('2026-06-27T12:00:00');
    expect(daysUntil('תמוז', 12, today)).toBe(0);
  });

  it('כתיב חשון/חשוון/מרחשוון מתאחד', () => {
    expect(normalizeMonth('מרחשוון')).toBe(normalizeMonth('חשון'));
    expect(normalizeMonth('חשוון')).toBe('חשון');
  });
});

describe('formatHebrew', () => {
  it('12 תמוז → י״ב תמוז', () => {
    expect(formatHebrew(12, 'תמוז')).toBe('י״ב תמוז');
  });
});
