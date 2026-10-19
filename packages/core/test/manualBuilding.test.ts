import { describe, expect, it } from 'vitest';
import { type Db, addManualBuilding, getBuilding, manualBuildings, matchBuildings, pointInPolygon } from '../src/index.js';

describe('בניין ידני', () => {
  it('נוצר בנקודה, מקושר לכתובת ומופיע ברשימת המבנים', () => {
    const db: Db = { meta: { lastModified: 0 } } as Db;
    const pt: [number, number] = [35.23, 31.83];
    const b = addManualBuilding(db, 'הרב ניסים 5', pt, { apts: 8, floors: 4 });
    expect(pointInPolygon(pt, b.polygon)).toBe(true);
    const info = getBuilding(db, 'הרב ניסים 5')!.info;
    expect(info.gisId).toBe('manual:הרב ניסים 5');
    const list = manualBuildings(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ street: 'הרב ניסים', num: 5, apts: 8, floors: 4 });
    const m = matchBuildings(db, list, {}).find((x) => x.key === 'הרב ניסים 5');
    expect(m?.official?.id).toBe('manual:הרב ניסים 5');
  });
});
