import { describe, expect, it } from 'vitest';
import { type Db, addDonation, campaignTotals, donorSummaries, listDonations, monthlyTotals } from '../src/index.js';

const now = new Date(2026, 9, 12, 12);
const db = (): Db => ({
  'א 1': { info: {}, apts: [
    { id: 'a', name: 'כהן', donations: [{ date: '2026-10-05', amount: 1800, campaign: 'סוכות' }, { date: '1.9.2026', amount: '200' as unknown as number }], interactions: [{ date: '2026-10-01', type: 'שיחה' }] },
    { id: 'b', name: 'לוי', donations: [{ date: '2026-03-01', amount: 500, campaign: 'פורים' }], interactions: [{ date: '2026-03-02', type: 'שיחה' }] },
    { id: 'c', name: 'מחוק', deletedAt: 1, donations: [{ date: '2026-10-01', amount: 999 }] },
  ] },
} as Db);

describe('תרומות', () => {
  it('רשימה, תאריכים מעורבים, סכום כמחרוזת, מחוקות לא נספרות', () => {
    const rows = listDonations(db());
    expect(rows.map((r) => [r.name, r.amount, r.campaign])).toEqual([['משפחת כהן', 1800, 'סוכות'], ['משפחת כהן', 200, 'כללי'], ['משפחת לוי', 500, 'פורים']]);
  });

  it('סיכום תורמים וצריך תודה', () => {
    const s = donorSummaries(db(), now);
    const cohen = s.find((x) => x.name === 'משפחת כהן')!;
    expect(cohen).toMatchObject({ total: 2000, count: 2, needsThanks: true }); // תרמו 5.10, קשר אחרון 1.10
    expect(s.find((x) => x.name === 'משפחת לוי')!.needsThanks).toBe(false);
  });

  it('לפי חודש ולפי קמפיין', () => {
    const rows = listDonations(db());
    const m = monthlyTotals(rows, 12, now);
    expect(m).toHaveLength(12);
    expect(m[11]!.total).toBe(1800); // אוקטובר
    expect(m[10]!.total).toBe(200); // ספטמבר
    expect(m[5]!.total).toBe(0); // אפריל
    expect(m[4]!.total).toBe(500); // מרץ
    expect(campaignTotals(rows).get('פורים')).toBe(500);
  });

  it('הוספת תרומה', () => {
    const d = db();
    addDonation(d, { bldg: 'א 1', idx: 1 }, { amount: 360, campaign: 'חנוכה', date: '2026-10-12' });
    expect(listDonations(d)[0]).toMatchObject({ name: 'משפחת לוי', amount: 360, campaign: 'חנוכה' });
  });
});
