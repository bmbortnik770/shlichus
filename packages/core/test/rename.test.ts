import { describe, expect, it } from 'vitest';
import { type Db, getBuilding, renameListValue } from '../src/index.js';

describe('שינוי שם לתגית/סגנון', () => {
  it('מעדכן את הרשימה, הצבע וכל המשפחות', () => {
    const db = {
      meta: { lastModified: 0 }, __SETTINGS__: { tags: ['תורם', 'מקורב'], tagColors: { 'תורם': '#111111' }, styles: ['חב"ד'] },
      'א 1': { info: {}, apts: [{ name: 'כהן', tags: ['תורם', 'מקורב'], style: 'חב"ד' }, { name: 'לוי', tags: ['מקורב'] }] },
    } as unknown as Db;
    expect(renameListValue(db, 'tags', 'תורם', 'תורם קבוע')).toBe(1);
    expect(db.__SETTINGS__!.tags).toEqual(['תורם קבוע', 'מקורב']);
    expect((db.__SETTINGS__!.tagColors as Record<string, string>)['תורם קבוע']).toBe('#111111');
    expect(getBuilding(db, 'א 1')!.apts[0]!.tags).toEqual(['תורם קבוע', 'מקורב']);
    expect(renameListValue(db, 'styles', 'חב"ד', 'חסידי')).toBe(1);
    expect(getBuilding(db, 'א 1')!.apts[0]!.style).toBe('חסידי');
  });
});
