import { describe, it, expect } from 'vitest';
import { occasionsOn, upcomingOccasions, hebrewYear, hebrewDateLine } from '../src/jewishCalendar.js';

describe('jewishCalendar', () => {
  it('ל׳ תשרי תשפ״ז (11.10.2026) = ראש חודש חשוון', () => {
    const o = occasionsOn(new Date(2026, 9, 11, 12));
    expect(o.map((x) => x.kind)).toEqual(['rosh-chodesh']);
    expect(o[0]!.title).toContain('חשוון');
    expect(o[0]!.message).toContain('חודש חשוון טוב');
  });
  it('א׳ תשרי אינו ראש חודש אלא ראש השנה', () => {
    const o = occasionsOn(new Date(2026, 8, 12, 12));
    expect(o.map((x) => x.title)).toEqual(['ראש השנה']);
  });
  it('י״ט כסלו תשפ״ז מזוהה', () => {
    const days = upcomingOccasions(new Date(2026, 10, 25), 10);
    expect(days.some((d) => d.occasions.some((o) => o.title.startsWith('י״ט כסלו')))).toBe(true);
  });
  it('שנים עבריות', () => {
    expect(hebrewYear(5787)).toBe('תשפ״ז');
    expect(hebrewYear(5786)).toBe('תשפ״ו');
    expect(hebrewYear(5775)).toBe('תשע״ה');
    expect(hebrewYear(5776)).toBe('תשע״ו');
  });
  it('שורת תאריך', () => {
    expect(hebrewDateLine(new Date(2026, 9, 11, 12))).toBe('יום ראשון · ל׳ תשרי תשפ״ז');
  });
});
