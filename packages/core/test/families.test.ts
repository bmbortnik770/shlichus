import { describe, expect, it } from 'vitest';
import {
  type Db, NO_ADDRESS_KEY, addFamily, deleteFamily, familyPhones, getBuilding, listFamilies, mergeDb,
  moveFamily, splitFamily, waLink,
} from '../src/index.js';

const base = (): Db => ({
  __NO_ADDRESS__: { info: {}, apts: [{ id: 'a1', name: 'כהן', interactions: [{ date: '2026-10-01', type: 'שיחה' }] }] },
  'שמואל תמיר 19': { info: {}, apts: [{ id: 'b1', name: 'לוי', num: '4' }] },
} as Db);

describe('משפחות', () => {
  it('רשימה כוללת ללא כתובת ומדלגת על מחוקות', () => {
    const db = base();
    deleteFamily(db, { bldg: 'שמואל תמיר 19', idx: 0 });
    expect(listFamilies(db).map((r) => r.apt.name)).toEqual(['כהן']);
  });

  it('שיבוץ כתובת: המשפחה עוברת עם כל ההיסטוריה ולא חוזרת אחרי סנכרון', () => {
    const remote = base();
    const local = base();
    const to = moveFamily(local, { bldg: NO_ADDRESS_KEY, idx: 0 }, 'דוד ניב 18', '7')!;
    expect(to).toEqual({ bldg: 'דוד ניב 18', idx: 0 });
    expect(getBuilding(local, 'דוד ניב 18')!.apts[0]).toMatchObject({ id: 'a1', name: 'כהן', num: '7' });
    expect(getBuilding(local, 'דוד ניב 18')!.apts[0]!.interactions).toHaveLength(1);
    const merged = mergeDb(local, remote);
    expect(listFamilies(merged).filter((r) => r.apt.name === 'כהן').map((r) => r.bldg)).toEqual(['דוד ניב 18']);
  });

  it('החזרה למקום הקודם מחליפה את המצבה ולא יוצרת כפילות', () => {
    const db = base();
    const to = moveFamily(db, { bldg: NO_ADDRESS_KEY, idx: 0 }, 'דוד ניב 18')!;
    moveFamily(db, to, NO_ADDRESS_KEY);
    expect(getBuilding(db, NO_ADDRESS_KEY)!.apts).toHaveLength(1);
    expect(listFamilies(db).filter((r) => r.apt.name === 'כהן').map((r) => r.bldg)).toEqual([NO_ADDRESS_KEY]);
  });

  it('הוספה ופיצול', () => {
    const db = base();
    const ref = addFamily(db, 'שמואל תמיר 19', { name: 'פרץ' });
    expect(getBuilding(db, 'שמואל תמיר 19')!.apts[ref.idx]).toMatchObject({ name: 'פרץ' });
    const sp = splitFamily(db, ref, 'יוסי פרץ')!;
    expect(sp.bldg).toBe(NO_ADDRESS_KEY);
    expect(getBuilding(db, 'שמואל תמיר 19')!.apts[ref.idx]!.splits).toHaveLength(1);
  });

  it('טלפונים ווואטסאפ', () => {
    expect(familyPhones({ fatherPhone: '050-1234567', motherPhone: '050-1234567', phones: '02-5551234, 052 7654321' })).toEqual(['0501234567', '025551234', '0527654321']);
    expect(waLink('050-1234567', 'שלום')).toBe('https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D');
  });
});
