import { describe, expect, it } from 'vitest';
import { type Db, computeToday } from '../src/index.js';

describe('היום: תאריכי לידה ואירועי חיים', () => {
  it('בר מצווה בעוד 20 יום, יום הולדת בעוד 3, יום שנה לחתונה בעוד 5', () => {
    const now = new Date(2026, 9, 19, 9);
    const db = {
      meta: { lastModified: 0 },
      'דוד ניב 16': { info: {}, apts: [{ name: 'כהן', father: 'אברהם', fatherDob: '1986-10-20',
        childrenList: [{ name: 'מנחם', gender: 'boy', dob: '2013-11-08' }, { name: 'חיה', gender: 'girl', dob: '2018-10-22' }],
        lifecycleEvents: [{ type: 'wedding', date: '2025-10-24', memberKey: 'family' }],
        interactions: [{ date: '2026-10-18', type: 'שיחה' }] }] },
    } as unknown as Db;
    const t = computeToday(db, { now });
    const r = t.items[0]!.reasons.map((x) => `${x.label}: ${x.detail}`).join(' | ');
    expect(r).toContain('בר מצווה למנחם');
    expect(r).toContain('יום הולדת לחיה');
    expect(r).toContain('יום הולדת לאברהם');
    expect(r).toContain('יום שנה לחתונה');
    expect(t.upcoming.map((u) => u.title).join('|')).toContain('חיה');
  });
});
