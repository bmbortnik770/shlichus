import { describe, it, expect } from 'vitest';
import { mergeDb, softDeleteApt, liveApts, aptIdentity } from '../src/merge.js';
import type { Apartment, Db } from '../src/types.js';

const bldg = (apts: Apartment[], info: Record<string, unknown> = {}) => ({ info, apts });
const db = (entries: Record<string, ReturnType<typeof bldg>>, meta = { lastModified: 0 }): Db =>
  ({ meta, ...entries }) as Db;

describe('mergeDb — איחוד בניינים ודירות', () => {
  it('בניין שקיים רק בענן מתווסף', () => {
    const local = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', updatedAt: 100 }]) });
    const remote = db({ 'ביאליק 2': bldg([{ name: 'לוי', num: '3', updatedAt: 100 }]) });
    const merged = mergeDb(local, remote);
    expect(merged['הרצל 1']).toBeDefined();
    expect(merged['ביאליק 2']).toBeDefined();
  });

  it('בניין שקיים רק מקומית נשמר (לא נמחק ע"י הענן)', () => {
    const local = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1' }]) });
    const remote = db({});
    expect(mergeDb(local, remote)['הרצל 1']).toBeDefined();
  });

  it('דירה עם updatedAt חדש יותר מנצחת', () => {
    const local = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', notes: 'ישן', updatedAt: 100 }]) });
    const remote = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', notes: 'חדש', updatedAt: 200 }]) });
    const merged = mergeDb(local, remote);
    const apts = (merged['הרצל 1'] as { apts: Apartment[] }).apts;
    expect(apts).toHaveLength(1);
    expect(apts[0]!.notes).toBe('חדש');
  });

  it('דירות ישנות בלי updatedAt — עדיפות למקומי, בלי כפילויות', () => {
    const local = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', notes: 'מקומי' }]) });
    const remote = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', notes: 'ענן' }]) });
    const apts = (mergeDb(local, remote)['הרצל 1'] as { apts: Apartment[] }).apts;
    expect(apts).toHaveLength(1);
    expect(apts[0]!.notes).toBe('מקומי');
  });
});

describe('mergeDb — מחיקות (הבאג הקריטי בישן)', () => {
  it('דירה שנמחקה מקומית לא קמה לתחייה מהענן', () => {
    const apt: Apartment = { name: 'כהן', num: '1', updatedAt: 100 };
    softDeleteApt(apt);
    const local = db({ 'הרצל 1': bldg([apt]) });
    const remote = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', updatedAt: 100 }]) });
    const merged = mergeDb(local, remote);
    const apts = (merged['הרצל 1'] as { apts: Apartment[] }).apts;
    expect(apts).toHaveLength(1);
    expect(apts[0]!.deletedAt).toBeDefined();
    expect(liveApts(apts)).toHaveLength(0);
  });

  it('עריכה אחרי מחיקה (במכשיר אחר) מחזירה את הדירה', () => {
    const local = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', deletedAt: 100, updatedAt: 100 }]) });
    const remote = db({ 'הרצל 1': bldg([{ name: 'כהן', num: '1', notes: 'עודכן', updatedAt: 200 }]) });
    const apts = (mergeDb(local, remote)['הרצל 1'] as { apts: Apartment[] }).apts;
    expect(apts[0]!.deletedAt).toBeUndefined();
    expect(liveApts(apts)).toHaveLength(1);
  });
});

describe('mergeDb — info, לוחות והגדרות (שהישן זרק)', () => {
  it('שינוי info מהענן עם חותמת חדשה יותר נקלט', () => {
    const local = db({ 'הרצל 1': { info: { rep: 'ישן', updatedAt: 100 }, apts: [] } });
    const remote = db({ 'הרצל 1': { info: { rep: 'חדש', updatedAt: 200 }, apts: [] } });
    const merged = mergeDb(local, remote);
    expect((merged['הרצל 1'] as { info: { rep: string } }).info.rep).toBe('חדש');
  });

  it('לוח שנוצר בענן מתווסף; לוח מקומי נשמר', () => {
    const local: Db = { meta: { lastModified: 0 }, __BOARDS__: [{ id: 'a', name: 'מקומי', columns: [] }] };
    const remote: Db = { meta: { lastModified: 0 }, __BOARDS__: [{ id: 'b', name: 'ענן', columns: [] }] };
    const merged = mergeDb(local, remote);
    expect(merged.__BOARDS__!.map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('הגדרות: הצד המאוחר מנצח', () => {
    const local: Db = { meta: { lastModified: 100 }, __SETTINGS__: { themeColor: 'blue' } };
    const remote: Db = { meta: { lastModified: 200 }, __SETTINGS__: { themeColor: 'red' } };
    expect(mergeDb(local, remote).__SETTINGS__!.themeColor).toBe('red');
  });

  it('meta.lastModified = המקסימום', () => {
    const merged = mergeDb(db({}, { lastModified: 100 }), db({}, { lastModified: 200 }));
    expect(merged.meta!.lastModified).toBe(200);
  });
});

describe('mergeDb — meta: אירועים ומשימות מהשטח', () => {
  it('משימות כלליות מתאחדות משני הצדדים; "בוצע" מנצח', () => {
    const local: Db = { meta: { lastModified: 100, generalTasks: [
      { text: 'א', date: '1', done: true }, { text: 'ב', date: '2', done: false },
    ] } };
    const remote: Db = { meta: { lastModified: 200, generalTasks: [
      { text: 'א', date: '1', done: false }, { text: 'ג', date: '3', done: false },
    ] } };
    const tasks = mergeDb(local, remote).meta!.generalTasks as { text: string; done: boolean }[];
    expect(tasks.map((t) => t.text).sort()).toEqual(['א', 'ב', 'ג']);
    expect(tasks.find((t) => t.text === 'א')!.done).toBe(true);
  });

  it('אירועים מתאחדים לפי id; גרסה עם יותר נרשמים מנצחת', () => {
    const local: Db = { meta: { lastModified: 100, events: [
      { id: 'e1', name: 'התוועדות', registrants: [{ name: 'א' }] },
    ] } };
    const remote: Db = { meta: { lastModified: 200, events: [
      { id: 'e1', name: 'התוועדות', registrants: [{ name: 'א' }, { name: 'ב' }] },
      { id: 'e2', name: 'שיעור' },
    ] } };
    const events = mergeDb(local, remote).meta!.events as { id: string; registrants?: unknown[] }[];
    expect(events.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(events.find((e) => e.id === 'e1')!.registrants).toHaveLength(2);
  });

  it('שדות meta אחרים — הצד המאוחר מנצח', () => {
    const local: Db = { meta: { lastModified: 100, someFlag: 'ישן' } };
    const remote: Db = { meta: { lastModified: 200, someFlag: 'חדש' } };
    expect(mergeDb(local, remote).meta!.someFlag).toBe('חדש');
  });
});

describe('aptIdentity — תאימות לאחור', () => {
  it('בלי id — זהות לפי name_num כמו בישן', () => {
    expect(aptIdentity({ name: 'כהן', num: '3' })).toBe('legacy:כהן_3');
  });
  it('עם id — זהות יציבה גם אם שם השתנה', () => {
    expect(aptIdentity({ id: 'x1', name: 'שם חדש' })).toBe('id:x1');
  });
});
