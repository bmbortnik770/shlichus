import { describe, expect, it } from 'vitest';
import { type Db, NO_ADDRESS_KEY, getBuilding, guessMapping, importRows, listFamilies, parseCsv } from '../src/index.js';

describe('ייבוא', () => {
  it('CSV עם מירכאות, BOM ושורות Windows', () => {
    const rows = parseCsv('﻿שם משפחה,כתובת,טלפון\r\n"כהן, יוסי","שמואל תמיר 19",050-1234567\r\n\r\nלוי,,052-7654321');
    expect(rows).toEqual([['שם משפחה', 'כתובת', 'טלפון'], ['כהן, יוסי', 'שמואל תמיר 19', '050-1234567'], ['לוי', '', '052-7654321']]);
  });

  it('זיהוי עמודות', () => {
    expect(guessMapping(['שם משפחה', 'שם האב', 'שם האם', 'כתובת', 'דירה', 'טלפון', 'טלפון נוסף', 'מייל', 'תגיות'])).toEqual({
      name: 0, father: 1, mother: 2, bldg: 3, num: 4, phone: 5, phone2: 6, email: 7, tags: 8,
    });
  });

  it('ייבוא בלי כפילויות, תגיות לרשימה, בלי כתובת → ללא כתובת', () => {
    const db = { 'שמואל תמיר 19': { info: {}, apts: [{ name: 'קיים', fatherPhone: '050-1234567' }] }, __SETTINGS__: { tags: ['תורם'] } } as Db;
    const rows = [['שם', 'כתובת', 'דירה', 'טלפון', 'תגיות'],
      ['כהן', 'שמואל תמיר 19', '3', '0501234567', ''], // טלפון קיים → מדולג
      ['לוי', 'שמואל תמיר 19', '4', '052-7654321', 'מקורב|תורם'],
      ['לוי', 'שמואל תמיר 19', '4', '', ''], // אותו שם, כתובת ודירה → מדולג
      ['פרץ', '', '', '053-1112233', ''],
      ['', '', '', '', '']];
    const res = importRows(db, rows, guessMapping(rows[0]!));
    expect(res).toEqual({ imported: 2, skipped: 3, noAddress: 1 });
    expect(getBuilding(db, 'שמואל תמיר 19')!.apts.map((a) => a.name)).toEqual(['קיים', 'לוי']);
    expect(getBuilding(db, NO_ADDRESS_KEY)!.apts[0]).toMatchObject({ name: 'פרץ', fatherPhone: '053-1112233' });
    expect(db.__SETTINGS__!.tags).toEqual(['תורם', 'מקורב']);
    expect(listFamilies(db)).toHaveLength(3);
  });
});
