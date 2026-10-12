import { describe, expect, it } from 'vitest';
import {
  type Db, type GeoHit, type OfficialBuilding, buildingKeys, getBuilding, mergeDb, resolveBuildingKey,
  addressMatchesOfficial, categoryFromUse, distanceToPolygonM, geocodeAddress, isBrokenAddress, labelPoint,
  linkBuilding, matchBuildings, moveBuilding, parseAddress, parseJerusalemFeature, parseOsmElement,
  pointInPolygon, polygonInTerritory, streetTokens, fetchBuildingsFor, fetchJerusalemBuildings, preferredAddress, pendingFixes, applyFix, linkManually, cleanAddress, brokenKind,
} from '../src/index.js';

/** ריבוע של כ-20 מ' סביב נקודה */
function square(lng: number, lat: number, half = 0.0001): [number, number][] {
  return [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half]];
}
function official(id: string, street: string, num: number | null, lng: number, lat: number, extra: Partial<OfficialBuilding> = {}): OfficialBuilding {
  return { id, polygon: square(lng, lat), street, num, apts: null, floors: null, entrances: null, use: '', ...extra };
}
const apt = (name: string) => ({ lastName: name, num: '1', id: `a_${name}` });

describe('כתובות', () => {
  it('מפרק רחוב, מספר ואות', () => {
    expect(parseAddress('שמואל תמיר 19')).toEqual({ street: 'שמואל תמיר', num: 19, suffix: '' });
    expect(parseAddress('האלוף יקותיאל אדם 5א')).toEqual({ street: 'האלוף יקותיאל אדם', num: 5, suffix: 'א' });
    expect(parseAddress('ירמיהו ברדנוב').num).toBeNull();
  });
  it('מנקה כפילות ופיסוק', () => {
    expect(streetTokens('דוד ניב ניב')).toEqual(['דוד', 'ניב']);
    expect(streetTokens(`רח' משה רחמילביץ'`)).toEqual(['משה', 'רחמילביץ']);
  });
  it('מתאים לשם הרשמי הארוך ולה"א הידיעה', () => {
    expect(addressMatchesOfficial('שמואל תמיר 23', official('x', 'שמואל תמיר כצנלסון', 23, 0, 0))).toBe(true);
    expect(addressMatchesOfficial('האלוף יקותיאל אדם 5', official('x', 'אלוף יקותיאל אדם', 5, 0, 0))).toBe(true);
    expect(addressMatchesOfficial('דוד ניב ניב 16', official('x', 'דוד ניב', 16, 0, 0))).toBe(true);
    expect(addressMatchesOfficial('שמואל תמיר 2', official('x', 'שמואל תמיר כצנלסון', 23, 0, 0))).toBe(false);
    expect(addressMatchesOfficial('משה דיין 23', official('x', 'שמואל תמיר כצנלסון', 23, 0, 0))).toBe(false);
  });
  it('מזהה כתובות פגומות', () => {
    expect(isBrokenAddress('065 ×—×™×™×‌ ×‘×¨ ×œ×‘')).toBe(true);
    expect(isBrokenAddress('ירמיהו ברדנוב')).toBe(true);
    expect(isBrokenAddress('דוד ניב ניב 10')).toBe(true);
    expect(isBrokenAddress('שמואל תמיר 19')).toBe(false);
    expect(isBrokenAddress(`משה רחמילביץ' 12`)).toBe(false);
  });
});

describe('גיאומטריה', () => {
  it('נקודת תווית תמיד בתוך מבנה בצורת L', () => {
    const L: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.0002], [0.0002, 0.0002], [0.0002, 0.001], [0, 0.001]];
    expect(pointInPolygon(labelPoint(L), L)).toBe(true);
  });
  it('מרחק לפוליגון במטרים', () => {
    const sq = square(35.2, 31.8);
    expect(distanceToPolygonM([35.2, 31.8], sq)).toBe(0);
    const d = distanceToPolygonM([35.2, 31.8 + 0.0001 + 0.00009], sq); // ~10 מ' צפונה מהקצה
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });
  it('תיחום לפי המבנה כולו ולא לפי נקודת לחיצה', () => {
    const territory = square(35.2, 31.8, 0.001);
    expect(polygonInTerritory(square(35.2, 31.8), territory)).toBe(true);
    // מבנה שרובו בחוץ, אף שפינה אחת בפנים
    expect(polygonInTerritory(square(35.20108, 31.8), territory)).toBe(false);
    // מבנה שרובו בפנים ונקודת התווית שלו בפנים
    expect(polygonInTerritory(square(35.20095, 31.8), territory)).toBe(true);
    expect(polygonInTerritory(square(35.2, 31.8), undefined)).toBe(true);
  });
});

describe('סיווג', () => {
  it('לפי שם המוסד', () => {
    expect(categoryFromUse('גן ילדים אפרוח')).toBe('education');
    expect(categoryFromUse('גו ילדים פסגת זאב מערב')).toBe('education');
    expect(categoryFromUse('בית הכנסת  הגדול פסגת רם')).toBe('synagogue');
    expect(categoryFromUse('מרכז לתורה ותפילה בית משיח')).toBe('synagogue');
    expect(categoryFromUse('תחנת פיס לבריאות המשפחה')).toBe('medical');
    expect(categoryFromUse('קניון הפסגה')).toBe('business');
    expect(categoryFromUse('מרכז קהילתי פסגת זאב')).toBe('offices');
    expect(categoryFromUse('לא יהודי')).toBeNull();
    expect(categoryFromUse('')).toBeNull();
  });
});

describe('מקורות', () => {
  it('ירושלים: פירוק רשומה', () => {
    const b = parseJerusalemFeature({
      attributes: { OBJECTID: 57601271, StreetName1: 'שמואל תמיר כצנלסון', BLDG_NUM: 23, BLDG_CH: ' ', NUM_FLOORS: 3, NUM_ENTR: 1, NUM_APTS_C: 4, StreetName2: ' ' },
      geometry: { rings: [[[35.1, 31.8], [35.2, 31.8], [35.2, 31.9], [35.1, 31.8]]] },
    })!;
    expect(b).toMatchObject({ id: 'jlm:57601271', street: 'שמואל תמיר כצנלסון', num: 23, apts: 4, floors: 3, use: '' });
    expect(b.street2).toBeUndefined();
    expect(b.polygon).toHaveLength(3); // נקודת הסגירה הוסרה
  });
  it('OSM: צורה סגורה, קומות, דירות ובית כנסת', () => {
    const geometry = [{ lat: 31.8, lon: 35.1 }, { lat: 31.8, lon: 35.2 }, { lat: 31.9, lon: 35.2 }, { lat: 31.8, lon: 35.1 }];
    const b = parseOsmElement({ type: 'way', id: 42, geometry, tags: { building: 'yes', amenity: 'place_of_worship', religion: 'jewish', 'building:levels': '2', 'building:flats': '6', 'addr:street': 'הרצל', 'addr:housenumber': '5' } })!;
    expect(b).toMatchObject({ id: 'osm:w42', floors: 2, apts: 6, street: 'הרצל', num: 5 });
    expect(categoryFromUse(b.use)).toBe('synagogue');
    expect(parseOsmElement({ type: 'way', id: 1, geometry: geometry.slice(0, 3) })).toBeNull();
  });
  it('ירושלים: ממשיך לדף הבא כשהדף מלא, גם בלי סימון מהשרת', async () => {
    const feat = (id: number) => ({ attributes: { OBJECTID: id, StreetName1: 'א', BLDG_NUM: 1 }, geometry: { rings: [[[35.2, 31.8], [35.21, 31.8], [35.21, 31.81], [35.2, 31.8]]] } });
    const fake = (async (url: string) => {
      const off = Number(new URL(url).searchParams.get('resultOffset'));
      const size = Number(new URL(url).searchParams.get('resultRecordCount'));
      const total = 973;
      const n = Math.max(0, Math.min(size, total - off));
      return new Response(JSON.stringify({ features: Array.from({ length: n }, (_, i) => feat(off + i + 1)) }));
    }) as typeof fetch;
    expect(await fetchJerusalemBuildings([35.2, 31.8, 35.21, 31.81], fake)).toHaveLength(973);
  });
  it('בוחר מקור עירוני כשקיים, ונופל לארצי מחוץ לעיר', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('jerusalem')) return new Response(JSON.stringify({ features: [{ attributes: { OBJECTID: 1, StreetName1: 'א', BLDG_NUM: 1 }, geometry: { rings: [[[35.2, 31.8], [35.21, 31.8], [35.21, 31.81], [35.2, 31.8]]] } }] }));
      return new Response(JSON.stringify({ elements: [] }));
    }) as typeof fetch;
    expect((await fetchBuildingsFor([35.2, 31.8, 35.21, 31.81], fake)).source.id).toBe('jlm');
    expect((await fetchBuildingsFor([34.78, 32.07, 34.79, 32.08], fake)).source.id).toBe('osm'); // תל אביב
    expect(calls.filter((c) => c.includes('jerusalem'))).toHaveLength(1);
  });
  it('GovMap: מקבל רק מספר בית מדויק', async () => {
    const respond = (text: string) => (async () => new Response(JSON.stringify({ results: [{ id: 'a', type: 'address', text, shape: 'POINT(3922615.85 3739830.73)' }] }))) as unknown as typeof fetch;
    const hit = await geocodeAddress('שמואל תמיר 19', 'ירושלים', respond('שמואל תמיר 19 ירושלים'));
    expect(hit!.point[0]).toBeCloseTo(35.2374, 3);
    expect(hit!.point[1]).toBeCloseTo(31.8209, 3);
    expect(await geocodeAddress('שמואל תמיר 1', 'ירושלים', respond('שמואל תמיר 11 ירושלים'))).toBeNull();
    expect(await geocodeAddress('יקותיאל אדם 5', 'ירושלים', respond('האלוף יקותיאל אדם 5א ירושלים'))).toBeNull();
  });
});

describe('התאמת בניינים', () => {
  const A = official('jlm:1', 'שמואל תמיר כצנלסון', 55, 35.2, 31.8, { apts: 12, entrances: 2 });
  const B = official('jlm:2', 'אברהם דוד ליכטמן', 3, 35.21, 31.8, { apts: 8, use: 'גן ילדים אפרוח' });
  const C = official('jlm:3', 'ירמיהו ברדנוב', 7, 35.22, 31.8, { apts: 6 });

  function makeDb(): Db {
    return {
      'שמואל תמיר 55': { info: { coords: [35.2, 31.8] }, apts: [apt('כהן')] },
      // כניסה שנייה של אותו מבנה — מאומתת ב-GovMap
      'שמואל תמיר 53': { info: { coords: [35.20005, 31.8] }, apts: [apt('לוי')] },
      // נשמר ליד המבנה (8 מ') — כתובת נכונה
      'אברהם דוד ליכטמן 3': { info: { coords: [35.21, 31.80017], category: 'residential' }, apts: [] },
      // כתובת בלי מספר, עם משפחה
      'ירמיהו ברדנוב': { info: { coords: [35.22, 31.8] }, apts: [apt('פרץ')] },
      'ירמיהו ברדנוב 7': { info: { coords: [35.22, 31.8] }, apts: [] },
      // במקום שאין בו מבנה
      'צבי לבנון 99': { info: { coords: [35.3, 31.9] }, apts: [] },
    } as Db;
  }
  const geo: Record<string, GeoHit | null> = { 'שמואל תמיר 53': { text: 'שמואל תמיר 53 ירושלים', id: 'g', point: [35.20003, 31.80002] } };

  it('מסווג לפי רמת אמון', () => {
    const m = Object.fromEntries(matchBuildings(makeDb(), [A, B, C], geo).map((x) => [x.key, x]));
    expect(m['שמואל תמיר 55']).toMatchObject({ method: 'address', confidence: 'high', relocate: false });
    expect(m['שמואל תמיר 53']).toMatchObject({ method: 'geocode', confidence: 'high' });
    expect(m['שמואל תמיר 53']!.official!.id).toBe('jlm:1');
    expect(m['אברהם דוד ליכטמן 3']).toMatchObject({ method: 'address', relocate: true, categoryTo: 'education', unitsTo: 8 });
    // בלי מספר בית: לא ממקמים ולא מנחשים לפי נקודה, גם אם יש בניין במקום
    expect(m['ירמיהו ברדנוב']).toMatchObject({ official: null, waitingForNumber: true, families: 1 });
    expect(m['ירמיהו ברדנוב']!.renameTo).toBeUndefined();
    expect(m['צבי לבנון 99']).toMatchObject({ official: null, confidence: 'none' });
  });

  it('דירות של מבנה עם כמה כניסות לא נכתבות על כניסה אחת', () => {
    const m = matchBuildings(makeDb(), [A, B, C], geo).find((x) => x.key === 'שמואל תמיר 55')!;
    expect(m.unitsTo).toBeUndefined();
  });

  it('קישור שם את הנקודה בתוך המבנה ושומר את הנתונים הרשמיים', () => {
    const db = makeDb();
    linkBuilding(db, 'אברהם דוד ליכטמן 3', B, 'address', { units: 8, category: 'education' });
    const info = getBuilding(db, 'אברהם דוד ליכטמן 3')!.info;
    expect(info.gisId).toBe('jlm:2');
    expect(pointInPolygon(info.coords as [number, number], B.polygon)).toBe(true);
    expect(info.category).toBe('education');
    expect(info.units).toMatchObject({ source: 'CITY', count: 8 });
  });

  it('קישור לא דורס מספר דירות שהוזן ידנית', () => {
    const db = makeDb();
    getBuilding(db, 'שמואל תמיר 55')!.info.units = { source: 'VERIFIED', count: 10 };
    const m = matchBuildings(db, [official('jlm:9', 'שמואל תמיר כצנלסון', 55, 35.2, 31.8, { apts: 12 })]).find((x) => x.key === 'שמואל תמיר 55')!;
    expect(m.unitsTo).toBeUndefined();
  });
});

describe('שם לבניין חדש', () => {
  it('לפי הכתיב שכבר בשימוש', () => {
    const db = { 'שמואל תמיר 19': { info: {}, apts: [] }, 'שמואל תמיר 17': { info: {}, apts: [] } } as Db;
    expect(preferredAddress(db, { street: 'שמואל תמיר כצנלסון', num: 23 })).toBe('שמואל תמיר 23');
    expect(preferredAddress(db, { street: 'דוד ניב', num: 4 })).toBe('דוד ניב 4');
  });
});

describe('העברת בניין וסנכרון', () => {
  it('ממזג לכתובת קיימת ומשאיר מצבה', () => {
    const db = { 'ירמיהו ברדנוב': { info: {}, apts: [apt('פרץ')] }, 'ירמיהו ברדנוב 7': { info: { code: 'x' }, apts: [apt('גל')] } } as Db;
    moveBuilding(db, 'ירמיהו ברדנוב', 'ירמיהו ברדנוב 7');
    expect(buildingKeys(db)).toEqual(['ירמיהו ברדנוב 7']);
    expect(getBuilding(db, 'ירמיהו ברדנוב 7')!.apts.map((a) => a.lastName).sort()).toEqual(['גל', 'פרץ']);
    expect(resolveBuildingKey(db, 'ירמיהו ברדנוב')).toBe('ירמיהו ברדנוב 7');
  });

  it('עותק ישן בדרייב לא מחזיר את הכתובת הישנה, ומשפחה שנוספה בו עוברת לחדשה', () => {
    const remote = { 'ירמיהו ברדנוב': { info: {}, apts: [apt('פרץ'), apt('חדש')] } } as Db;
    const local = structuredClone({ 'ירמיהו ברדנוב': { info: {}, apts: [apt('פרץ')] } }) as Db;
    moveBuilding(local, 'ירמיהו ברדנוב', 'ירמיהו ברדנוב 7');
    const merged = mergeDb(local, remote);
    expect(buildingKeys(merged)).toEqual(['ירמיהו ברדנוב 7']);
    expect(getBuilding(merged, 'ירמיהו ברדנוב 7')!.apts.map((a) => a.lastName).sort()).toEqual(['חדש', 'פרץ']);
    expect(getBuilding(merged, 'ירמיהו ברדנוב')!.apts).toHaveLength(0);
  });

  it('גם כשהמצבה מגיעה מהענן', () => {
    const local = { 'א 1': { info: { updatedAt: 1 }, apts: [apt('כהן')] } } as Db;
    const remote = structuredClone(local);
    moveBuilding(remote, 'א 1', 'א 2');
    const merged = mergeDb(local, remote);
    expect(buildingKeys(merged)).toEqual(['א 2']);
    expect(getBuilding(merged, 'א 2')!.apts).toHaveLength(1);
  });
});

describe('מילה כפולה בכתובת', () => {
  it('מתקן כתיב באותו מספר ולא מעביר לכניסה אחרת של הבניין', () => {
    expect(cleanAddress('דוד ניב ניב 18')).toBe('דוד ניב 18');
    expect(brokenKind('דוד ניב ניב 18')).toBe('doubled');
    expect(brokenKind('ירמיהו ברדנוב')).toBe('nonum');
    const big: OfficialBuilding = { id: 'jlm:16', polygon: square(35.2, 31.8), street: 'דוד ניב', num: 16, apts: 47, floors: 8, entrances: 4, use: '' };
    const db = {
      'דוד ניב ניב 16': { info: { coords: [35.2, 31.8] }, apts: [apt('א')] },
      'דוד ניב ניב 18': { info: { coords: [35.20005, 31.8] }, apts: [apt('ב'), apt('ג'), apt('ד')] },
      'שדרות משה דיין 154': { info: { coords: [35.2, 31.80005] }, apts: [] },
    } as Db;
    const geo = { 'דוד ניב ניב 18': { text: 'דוד ניב 18 ירושלים', id: 'g', point: [35.20004, 31.8] as [number, number] } };
    const fixes = Object.fromEntries(pendingFixes(db, matchBuildings(db, [big], geo), geo).map((f) => [f.key, f]));
    expect(fixes['דוד ניב ניב 18']).toMatchObject({ renameTo: 'דוד ניב 18', needsUser: false });
    expect(fixes['דוד ניב ניב 16']).toMatchObject({ renameTo: 'דוד ניב 16', needsUser: false });
    for (const f of Object.values(fixes)) applyFix(db, f);
    expect(buildingKeys(db).sort()).toEqual(['דוד ניב 16', 'דוד ניב 18', 'שדרות משה דיין 154']);
    expect(getBuilding(db, 'דוד ניב 18')!.apts).toHaveLength(3);
    expect(getBuilding(db, 'שדרות משה דיין 154')!.apts).toHaveLength(0);
  });
});

describe('רשימת תיקונים', () => {
  const A: OfficialBuilding = { id: 'jlm:1', polygon: square(35.2, 31.8), street: 'הרצל', num: 5, apts: 6, floors: 3, entrances: 1, use: '' };
  const B: OfficialBuilding = { id: 'jlm:2', polygon: square(35.21, 31.8), street: 'הרצל', num: 7, apts: 4, floors: 2, entrances: 1, use: 'גן ילדים' };

  it('מפריד בין בטוח לבין מה שדורש החלטה, ואחרי החלה לא נשאר כלום', () => {
    const db = {
      'הרצל 5': { info: { coords: [35.2, 31.8] }, apts: [apt('כהן')] },
      'הרצל': { info: { coords: [35.21, 31.8] }, apts: [apt('לוי')] }, // בלי מספר — ממתין
      'הרצל הרצל 7': { info: { coords: [35.3, 31.9] }, apts: [apt('גל')] }, // כתיב כפול, נקודה רחוקה — הכתובת קובעת
      'הרצל 9': { info: { coords: [36, 32] }, apts: [] }, // אין מבנה
    } as Db;
    const fixes = pendingFixes(db, matchBuildings(db, [A, B]));
    const by = Object.fromEntries(fixes.map((f) => [f.key, f]));
    expect(by['הרצל 5']).toMatchObject({ link: true, needsUser: false, units: 6 });
    expect(by['הרצל']).toBeUndefined();
    expect(by['הרצל הרצל 7']).toMatchObject({ renameTo: 'הרצל 7', needsUser: false, relocate: true, category: 'education' });
    expect(by['הרצל 9']).toMatchObject({ needsUser: true });

    for (const f of fixes) applyFix(db, f);
    expect(buildingKeys(db).sort()).toEqual(['הרצל', 'הרצל 5', 'הרצל 7', 'הרצל 9']);
    expect(getBuilding(db, 'הרצל')!.info.gisId).toBeUndefined();
    expect(getBuilding(db, 'הרצל 7')!.info).toMatchObject({ gisId: 'jlm:2', category: 'education' });
    const again = pendingFixes(db, matchBuildings(db, [A, B]));
    expect(again.map((f) => f.key)).toEqual(['הרצל 9']);
  });

  it('קישור ידני מנצח את ההתאמה האוטומטית', () => {
    const db = { 'הרצל 5': { info: { coords: [35.2, 31.8] }, apts: [] } } as Db;
    linkManually(db, 'הרצל 5', B);
    const m = matchBuildings(db, [A, B]).find((x) => x.key === 'הרצל 5')!;
    expect(m).toMatchObject({ method: 'manual', confidence: 'high' });
    expect(m.official!.id).toBe('jlm:2');
  });
});
