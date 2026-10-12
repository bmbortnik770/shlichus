import { describe, expect, it } from 'vitest';
import { type Db, addRegistrant, createEvent, listEvents, mergeDb, toggleAttendance, updateEvent } from '../src/index.js';

const base = (): Db => ({ meta: { lastModified: 1, events: [{ id: 'e1', name: 'סיום התניא', date: '2026-05-28', registrants: [], attendance: [] }] } } as Db);

describe('אירועים', () => {
  it('שינוי שם/שעה מקומי לא נדרס ע״י עותק ישן בענן', () => {
    const local = base(); const remote = base();
    updateEvent(local, 'e1', { time: '20:30', location: 'בית משיח' });
    const ev = listEvents(mergeDb(local, remote))[0]!;
    expect(ev).toMatchObject({ time: '20:30', location: 'בית משיח' });
  });

  it('נרשמים משני מכשירים מתאחדים', () => {
    const local = base(); const remote = base();
    addRegistrant(local, 'e1', { name: 'כהן' });
    (remote.meta!.events as { registrants: unknown[] }[])[0]!.registrants.push({ name: 'לוי' }); // מהשטח, בלי חותמת
    const ev = listEvents(mergeDb(local, remote))[0]!;
    expect(ev.registrants.map((r) => r.name).sort()).toEqual(['כהן', 'לוי']);
  });

  it('ביטול סימון נוכחות נשמר כשהשינוי נעשה כאן', () => {
    const local = base(); addRegistrant(local, 'e1', { name: 'כהן' }); toggleAttendance(local, 'e1', 'כהן');
    const remote = structuredClone(local);
    toggleAttendance(local, 'e1', 'כהן');
    expect(listEvents(mergeDb(local, remote))[0]!.attendance).toEqual([]);
  });

  it('יצירה וביטול אירוע', () => {
    const db = base();
    const id = createEvent(db, { name: 'קידוש', date: '2026-10-17' });
    expect(listEvents(db).map((e) => e.name)).toEqual(['קידוש', 'סיום התניא']);
    updateEvent(db, id, { cancelled: true });
    expect(listEvents(db).map((e) => e.name)).toEqual(['סיום התניא']);
  });
});
