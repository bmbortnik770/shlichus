import { describe, expect, it } from 'vitest';
import { type Db, applyFieldEvent, applyOutbox, getBuilding, listEvents, listFamilies, mergeDb } from '../src/index.js';

const db = (): Db => ({
  meta: { lastModified: 1, events: [{ id: 'e1', name: 'קידוש', registrants: [], attendance: [] }] },
  'א 1': { info: {}, apts: [{ id: 'a', name: 'כהן', num: '3', tasks: [{ text: 'להתקשר', done: false }], childrenList: [{ name: 'משה' }] }] },
} as Db);
const ts = '2026-10-19T10:00:00.000Z';

describe('עדכוני שטח', () => {
  it('ביקור, שיחה, משימה, תגית, תרומה, שלב בלוח — על המשפחה הנכונה', () => {
    const d = db();
    const base = { bldg: 'א 1', aptName: 'כהן', timestamp: ts };
    expect(applyFieldEvent(d, { ...base, type: 'visit_log', payload: { note: 'ביקור <b>טוב</b>', result: 'נכחו' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'call_log', payload: { note: 'שיחה' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'task_done', payload: { taskText: 'להתקשר' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'add_family_task', payload: { taskText: 'להביא חנוכייה', taskDate: '2026-12-01' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'tag_add', tag: 'מקורב' })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'add_donation', payload: { amount: 180, date: '2026-10-19' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'stage_change', payload: { boardId: 'b1', stage: 'בטיפול' } })).toBe(true);
    expect(applyFieldEvent(d, { ...base, type: 'contact_update', field: 'phone', value: '0501234567', attribution: 'child:משה' })).toBe(true);
    const a = getBuilding(d, 'א 1')!.apts[0]!;
    expect(a.interactions!.map((l) => l.type)).toEqual(['ביקור', 'שיחה']);
    expect(a.interactions![0]!.notes).toBe('ביקור &lt;b&gt;טוב&lt;/b&gt;'); // מוגן להצגה במערכת הקיימת
    expect(a.tasks!.map((t) => [t.text, !!t.done])).toEqual([['להתקשר', true], ['להביא חנוכייה', false]]);
    expect(a.tags).toEqual(['מקורב']);
    expect(a.donations).toHaveLength(1);
    expect(a.boards).toEqual({ b1: 'בטיפול' });
    expect((a.childrenList as { phone?: string }[])[0]!.phone).toBe('0501234567');
  });

  it('משפחה לא קיימת או בניין לא קיים — לא מיושם', () => {
    expect(applyFieldEvent(db(), { type: 'visit_log', bldg: 'א 1', aptName: 'אין כזה' })).toBe(false);
    expect(applyFieldEvent(db(), { type: 'visit_log', bldg: 'ב 9', aptName: 'כהן' })).toBe(false);
  });

  it('משפחה חדשה מקבלת מזהה; מחיקה היא מצבה ושורדת סנכרון', () => {
    const local = db();
    const remote = db();
    applyFieldEvent(local, { type: 'new_family', bldg: 'ג 5', payload: { name: 'לוי', num: '1' } });
    applyFieldEvent(local, { type: 'delete_family', bldg: 'א 1', aptName: 'כהן' });
    const merged = mergeDb(local, remote);
    expect(listFamilies(merged).map((f) => f.apt.name)).toEqual(['לוי']);
    expect(getBuilding(merged, 'ג 5')!.apts[0]!.id).toMatch(/^apt_/);
  });

  it('אירועי קהילה מהשטח', () => {
    const d = db();
    applyFieldEvent(d, { type: 'event_add_registrant', eventId: 'e1', payload: { regName: 'כהן', regPhone: '050' } });
    applyFieldEvent(d, { type: 'event_attendance', eventId: 'e1', payload: { regName: 'כהן', present: true } });
    applyFieldEvent(d, { type: 'event_create', payload: { name: 'שיעור', date: '2026-10-20' }, timestamp: ts });
    applyFieldEvent(d, { type: 'add_general_task', payload: { text: 'כיבוד', date: '2026-10-20' } });
    const ev = listEvents(d).find((e) => e.id === 'e1')!;
    expect([ev.registrants.length, ev.attendance]).toEqual([1, ['כהן']]);
    expect(listEvents(d).map((e) => e.name)).toContain('שיעור');
    expect((d.meta!.generalTasks as { text: string }[])[0]!.text).toBe('כיבוד');
  });

  it('קבצים: כל אירוע מוחל פעם אחת, כפילויות מסוננות, קבצים מטופלים לסל', () => {
    const d = db();
    const e = { id: 'x1', type: 'call_log', bldg: 'א 1', aptName: 'כהן', payload: { note: 'שלום' }, timestamp: ts };
    const files = [{ id: 'f1', payload: { events: [e, { ...e, id: 'x2' }] } }, { id: 'f2', payload: { events: [{ type: 'visit_log', bldg: 'ב 9', aptName: 'אין' }] } }];
    const r1 = applyOutbox(d, files, Date.parse(ts));
    expect(r1).toEqual({ applied: 1, trash: ['f1'] }); // x2 כפול בתוכן; f2 לא נמצא יעד — נשאר
    const r2 = applyOutbox(d, [files[0]!], Date.parse(ts));
    expect(r2).toEqual({ applied: 0, trash: ['f1'] });
    expect(getBuilding(d, 'א 1')!.apts[0]!.interactions).toHaveLength(1);
    expect(Object.keys(d.__SETTINGS__!.appliedEventIds as object).sort()).toEqual(['x1', 'x2']);
  });
});
