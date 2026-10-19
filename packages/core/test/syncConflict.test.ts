import { describe, expect, it } from 'vitest';
import { type Db, getBuilding, mergeDb } from '../src/index.js';

const base = (): Db => ({
  meta: { lastModified: 1 },
  'דוד ניב 16': { info: {}, apts: [{ id: 'a1', name: 'כהן', updatedAt: 100, interactions: [{ date: '2026-10-01', type: 'שיחה', text: 'ישן' }], donations: [], tasks: [{ text: 'לבקר', done: false }] }] },
} as unknown as Db);

describe('סנכרון: שני מכשירים משנים את אותה משפחה', () => {
  it('מכשיר א מוסיף תיעוד, מכשיר ב מוסיף תרומה — שניהם נשמרים', () => {
    const b = base();
    const a = base(); const ap = getBuilding(a, 'דוד ניב 16')!.apts[0]!;
    ap.interactions = [{ date: '2026-10-19', type: 'ביקור', text: 'חדש מא' }, ...(ap.interactions ?? [])]; ap.updatedAt = 200;
    const r = base(); const rp = getBuilding(r, 'דוד ניב 16')!.apts[0]!;
    rp.donations = [{ date: '2026-10-19', amount: 180 }]; rp.updatedAt = 300;
    const m = getBuilding(mergeDb(a, r, b), 'דוד ניב 16')!.apts[0]!;
    expect(m.interactions).toHaveLength(2);
    expect(m.donations).toHaveLength(1);
  });

  it('מחיקה במכשיר אחד והוספה בשני — המחיקה נשמרת וההוספה גם', () => {
    const b = base();
    const a = base(); const ap = getBuilding(a, 'דוד ניב 16')!.apts[0]!;
    ap.interactions = []; ap.updatedAt = 200; // נמחק התיעוד הישן
    const r = base(); const rp = getBuilding(r, 'דוד ניב 16')!.apts[0]!;
    rp.interactions = [...(rp.interactions ?? []), { date: '2026-10-19', type: 'שיחה', text: 'מב' }]; rp.updatedAt = 300;
    const m = getBuilding(mergeDb(a, r, b), 'דוד ניב 16')!.apts[0]!;
    expect(m.interactions?.map((x) => x.text)).toEqual(['מב']);
  });

  it('משימה סומנה בוצעה במכשיר אחד ונוספה משימה בשני', () => {
    const b = base();
    const a = base(); const ap = getBuilding(a, 'דוד ניב 16')!.apts[0]!;
    ap.tasks = [{ text: 'לבקר', done: true }]; ap.updatedAt = 200;
    const r = base(); const rp = getBuilding(r, 'דוד ניב 16')!.apts[0]!;
    rp.tasks = [...(rp.tasks ?? []), { text: 'להתקשר', done: false }]; rp.updatedAt = 300;
    const m = getBuilding(mergeDb(a, r, b), 'דוד ניב 16')!.apts[0]!;
    expect(m.tasks).toEqual([{ text: 'לבקר', done: true }, { text: 'להתקשר', done: false }]);
  });

  it('שדה פשוט שונה בשני המכשירים — המאוחר מנצח; שדה ששונה רק באחד נשמר', () => {
    const b = base();
    const a = base(); const ap = getBuilding(a, 'דוד ניב 16')!.apts[0]!;
    ap.notes = 'מא'; ap.fatherPhone = '0501111111'; ap.updatedAt = 200;
    const r = base(); const rp = getBuilding(r, 'דוד ניב 16')!.apts[0]!;
    rp.notes = 'מב'; rp.updatedAt = 300;
    const m = getBuilding(mergeDb(a, r, b), 'דוד ניב 16')!.apts[0]!;
    expect(m.notes).toBe('מב');
    expect(m.fatherPhone).toBe('0501111111');
  });

  it('הגדרות: תגיות במכשיר אחד וסידור תפריט בשני — שניהם נשמרים', () => {
    const b = { ...base(), __SETTINGS__: { tags: ['א'], updatedAt: 1 } } as Db;
    const a = { ...base(), __SETTINGS__: { tags: ['א', 'ב'], updatedAt: 200 } } as Db;
    const r = { ...base(), __SETTINGS__: { tags: ['א'], navLayouts: { x: 1 }, updatedAt: 300 } } as Db;
    const s = mergeDb(a, r, b).__SETTINGS__!;
    expect(s.tags).toEqual(['א', 'ב']);
    expect(s.navLayouts).toEqual({ x: 1 });
  });
});
