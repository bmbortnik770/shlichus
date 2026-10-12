/**
 * שכבת המבנים הרשמית — הבסיס של המפה.
 *
 * עיקרון: זהות של בניין = מבנה פיזי ממקור רשמי (מזהה קבוע + צורה מלאה),
 * לא מחרוזת כתובת ולא נקודת לחיצה. כתובות ה-CRM הן "כניסות" שמקושרות למבנה
 * (info.gisId). בניין עם כמה כניסות = כמה כתובות על אותו מבנה.
 *
 * מקורות (המערכת לכל הארץ — מקור עירוני הוא תוספת, לא תנאי):
 * - בסיס ארצי: OpenStreetMap — צורת כל מבנה בארץ עם מזהה קבוע (לפעמים גם כתובת/קומות/דירות).
 * - GovMap (המרכז למיפוי ישראל): נקודת כתובת רשמית לכל כתובת בארץ — קושרת כתובת למבנה.
 * - שכבת מבנים עירונית, איפה שקיימת (כרגע ירושלים): כתובת, דירות, קומות, כניסות ושם מוסד.
 */
import type { Apartment, BuildingInfo, Db } from './types.js';
import { buildingKeys, getBuilding } from './types.js';
import { getTerritory, pointInPolygon } from './territory.js';

export type LngLat = [number, number];
export type BBox = [west: number, south: number, east: number, north: number];

export interface OfficialBuilding {
  /** מזהה קבוע: "<מקור>:<מזהה>" */
  id: string;
  /** טבעת חיצונית [lng,lat] */
  polygon: LngLat[];
  street: string;
  num: number | null;
  street2?: string;
  apts: number | null;
  floors: number | null;
  entrances: number | null;
  /** שם מוסד/שימוש מהמקור, ריק למגורים רגילים */
  use: string;
}

/** הנתונים הרשמיים שנשמרים על הבניין ב-CRM */
export interface GisInfo {
  id: string;
  street: string;
  num: number | null;
  apts: number | null;
  floors: number | null;
  entrances: number | null;
  use: string;
  /** איך הכתובת קושרה למבנה */
  method: MatchMethod;
  at: number;
}

type FetchFn = typeof fetch;

// ─── גיאומטריה ─────────────────────────────────────────────────────

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export function distanceM(a: LngLat, b: LngLat): number {
  return Math.hypot((a[0] - b[0]) * mPerDegLng(a[1]), (a[1] - b[1]) * M_PER_DEG_LAT);
}

/** מרחק מנקודה לקצה הקרוב של פוליגון (0 אם בפנים) */
export function distanceToPolygonM(pt: LngLat, poly: LngLat[]): number {
  if (pointInPolygon(pt, poly)) return 0;
  const kx = mPerDegLng(pt[1]);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ax = (a[0] - pt[0]) * kx, ay = (a[1] - pt[1]) * M_PER_DEG_LAT;
    const bx = (b[0] - pt[0]) * kx, by = (b[1] - pt[1]) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** שטח במ"ר */
export function polygonAreaM2(poly: LngLat[]): number {
  if (poly.length < 3) return 0;
  const kx = mPerDegLng(poly[0]![1]);
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    s += a[0] * kx * (b[1] * M_PER_DEG_LAT) - b[0] * kx * (a[1] * M_PER_DEG_LAT);
  }
  return Math.abs(s) / 2;
}

/** נקודת תווית שתמיד בתוך המבנה (מרכז מסה, ואם הוא בחוץ — הנקודה הפנימית הקרובה אליו) */
export function labelPoint(poly: LngLat[]): LngLat {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  let c: LngLat;
  if (Math.abs(a) < 1e-14) {
    const n = poly.length || 1;
    c = [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  } else c = [cx / (3 * a), cy / (3 * a)];
  if (pointInPolygon(c, poly)) return c;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best: LngLat | null = null, bd = Infinity;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p: LngLat = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N];
      if (!pointInPolygon(p, poly)) continue;
      const d = distanceM(p, c);
      if (d < bd) { bd = d; best = p; }
    }
  }
  return best ?? poly[0] ?? c;
}

export function bboxOf(points: LngLat[], padM = 0): BBox {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const lat = (Math.min(...ys) + Math.max(...ys)) / 2;
  const dx = padM / mPerDegLng(lat), dy = padM / M_PER_DEG_LAT;
  return [Math.min(...xs) - dx, Math.min(...ys) - dy, Math.max(...xs) + dx, Math.max(...ys) + dy];
}

/** המבנה שהנקודה בתוכו; אם אין — הקרוב ביותר עד tolM מטרים */
export function buildingAt(pt: LngLat, list: OfficialBuilding[], tolM = 0): OfficialBuilding | null {
  let best: OfficialBuilding | null = null, bd = Infinity;
  for (const b of list) {
    const d = distanceToPolygonM(pt, b.polygon);
    if (d === 0) return b;
    if (d <= tolM && d < bd) { bd = d; best = b; }
  }
  return best;
}

/** מבנה בתוך התיחום: נקודת התווית בפנים, או רוב מוחלט של הקודקודים בפנים (מבנה על הקו) */
export function polygonInTerritory(poly: LngLat[], territory: LngLat[] | undefined): boolean {
  if (!territory || territory.length < 3) return true;
  if (pointInPolygon(labelPoint(poly), territory)) return true;
  const inside = poly.filter((p) => pointInPolygon(p, territory)).length;
  return inside / Math.max(1, poly.length) > 0.5;
}

// ─── כתובות ────────────────────────────────────────────────────────

const PREFIXES = new Set(['רחוב', 'רח', 'שד', 'שדרות', 'דרך', 'סמטת', 'כיכר']);

/** אסימוני שם רחוב: בלי פיסוק, בלי כפילות צמודה ("ניב ניב"), בלי קידומות סוג */
export function streetTokens(s: string): string[] {
  const t = String(s ?? '').replace(/["'`׳״\-.,()]/g, ' ').split(/\s+/).filter(Boolean);
  return t.filter((w, i) => w !== t[i - 1] && !PREFIXES.has(w));
}

const sameWord = (a: string, b: string) => a === b || a === `ה${b}` || `ה${a}` === b;

/** כל מילות הרחוב השמור מופיעות ברחוב הרשמי ("שמואל תמיר" ⊂ "שמואל תמיר כצנלסון") */
export function streetMatches(mine: string, official: string): boolean {
  const a = streetTokens(mine), b = streetTokens(official);
  return a.length > 0 && a.every((w) => b.some((x) => sameWord(w, x)));
}

export interface ParsedAddress { street: string; num: number | null; suffix: string }

export function parseAddress(text: string): ParsedAddress {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  const m = s.match(/^(.*?)[\s,]+(\d{1,4})\s*([א-ת])?$/);
  if (m) return { street: m[1]!.trim(), num: Number(m[2]), suffix: m[3] ?? '' };
  return { street: s, num: null, suffix: '' };
}

export type BrokenKind = 'garbled' | 'nonum' | 'doubled';

/** סוג הפגם בכתובת שמורה: תווים משובשים (קידוד), בלי מספר בית, או מילה כפולה ("דוד ניב ניב") */
export function brokenKind(key: string): BrokenKind | null {
  if (/[×Ã©â€]/.test(key) || /[^֐-׿a-zA-Z0-9\s"'`׳״\-.,()]/.test(key)) return 'garbled';
  const p = parseAddress(key);
  if (p.num == null) return 'nonum';
  const t = String(p.street).split(/\s+/);
  return t.some((w, i) => i > 0 && w === t[i - 1]) ? 'doubled' : null;
}

export function isBrokenAddress(key: string): boolean {
  return brokenKind(key) !== null;
}

/** תיקון כתיב בלבד: מסיר מילה כפולה ושומר את אותו מספר בית */
export function cleanAddress(key: string): string {
  const p = parseAddress(key);
  const t = p.street.split(/\s+/);
  const street = t.filter((w, i) => w !== t[i - 1]).join(' ');
  return p.num == null ? street : `${street} ${p.num}${p.suffix}`;
}

export function officialLabel(b: Pick<OfficialBuilding, 'street' | 'num'>): string {
  return b.num ? `${b.street} ${b.num}` : b.street;
}

export function addressMatchesOfficial(address: string, b: OfficialBuilding): boolean {
  const p = parseAddress(address);
  if (p.num == null || p.num !== b.num) return false;
  return streetMatches(p.street, b.street) || (!!b.street2 && streetMatches(p.street, b.street2));
}

// ─── סיווג לפי שם המוסד ────────────────────────────────────────────

const USE_RULES: [RegExp, string][] = [
  [/בית ה?כנסת|תורה ותפילה|ישיבה|כולל|מקווה|בית משיח|חב"ד/, 'synagogue'],
  [/גן ילדים|גו ילדים|^גן |בית ספר|בי"ס|ביה"ס|קרי?ית חינוך|תלמוד תורה|ת"ת|אולפנה|מעון|חינוך/, 'education'],
  [/בריאות|קופת חולים|קופ"ח|מרפאה|טיפת חלב|מרכז רפואי/, 'medical'],
  [/קניון|מרכז מסחרי|מסחר/, 'business'],
  [/מרכז קהילתי|מתנ"ס|עירי|משרד|דואר|משטרה|ספרייה|מינהל/, 'offices'],
];

/** קטגוריה מוצעת לפי שם השימוש במקור; null = אין הצעה */
export function categoryFromUse(use: string): string | null {
  const u = use.trim();
  if (!u) return null;
  for (const [re, cat] of USE_RULES) if (re.test(u)) return cat;
  return null;
}

// ─── מקור: עיריית ירושלים ──────────────────────────────────────────

const JLM_URL = 'https://gisviewer.jerusalem.muni.il/arcgis/rest/services/BaseLayers/MapServer/30/query';
const JLM_FIELDS = 'OBJECTID,StreetName1,BLDG_NUM,BLDG_CH,NUM_FLOORS,NUM_ENTR,NUM_APTS_C,StreetName2';

interface EsriFeature { attributes: Record<string, unknown>; geometry?: { rings?: number[][][] } }

const r7 = (n: number) => Math.round(n * 1e7) / 1e7;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const pos = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

export function parseJerusalemFeature(f: EsriFeature): OfficialBuilding | null {
  const ring = f.geometry?.rings?.[0];
  const a = f.attributes;
  if (!ring || ring.length < 4 || a.OBJECTID == null) return null;
  const poly = ring.map((p) => [r7(p[0]!), r7(p[1]!)] as LngLat);
  const last = poly[poly.length - 1]!, first = poly[0]!;
  if (last[0] === first[0] && last[1] === first[1]) poly.pop();
  return {
    id: `jlm:${a.OBJECTID}`,
    polygon: poly,
    street: str(a.StreetName1),
    num: pos(a.BLDG_NUM),
    street2: str(a.StreetName2) || undefined,
    apts: pos(a.NUM_APTS_C),
    floors: pos(a.NUM_FLOORS),
    entrances: pos(a.NUM_ENTR),
    // "99" ושם השכונה הם לא שם מוסד
    use: /^\d+$/.test(str(a.BLDG_CH)) ? '' : str(a.BLDG_CH),
  };
}

const JLM_PAGE = 400;

/**
 * בקשת JSON עם מגבלת זמן וניסיונות חוזרים — שרתים ציבוריים לפעמים איטיים מאוד,
 * ובקשה תקועה לא צריכה לתקוע את המפה.
 */
export async function fetchJsonRetry(fetchFn: FetchFn, url: string, what: string, init: RequestInit = {}, tries = 3, timeoutMs = 30_000): Promise<unknown> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
    try {
      const res = await fetchFn(url, { ...init, signal: ctrl?.signal });
      if (res.ok) return await res.json();
      last = `${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // שגיאת בקשה — ניסיון חוזר לא יעזור
    } catch (e) {
      last = e instanceof Error && e.name === 'AbortError' ? 'לא הגיב בזמן' : 'אין חיבור';
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error(`${what} לא זמינה כרגע (${last})`);
}

/** כל המבנים בתיבה, עם דפדוף (השרת מחזיר עד 1000 לבקשה) */
export async function fetchJerusalemBuildings(bbox: BBox, fetchFn: FetchFn = fetch): Promise<OfficialBuilding[]> {
  const out: OfficialBuilding[] = [];
  for (let offset = 0; offset < 20_000; offset += JLM_PAGE) {
    const params = new URLSearchParams({
      geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: JLM_FIELDS, returnGeometry: 'true',
      orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(JLM_PAGE), f: 'json',
    });
    const j = (await fetchJsonRetry(fetchFn, `${JLM_URL}?${params}`, 'שכבת המבנים של העירייה')) as { features?: EsriFeature[]; exceededTransferLimit?: boolean; error?: { message?: string } };
    if (j.error) throw new Error(`שכבת המבנים של העירייה: ${j.error.message ?? 'שגיאה'}`);
    for (const f of j.features ?? []) {
      const b = parseJerusalemFeature(f);
      if (b) out.push(b);
    }
    // השרת (ArcGIS 10.3) לא מחזיר exceededTransferLimit כשמבקשים גודל עמוד — דף מלא = יש עוד
    if (!j.exceededTransferLimit && (j.features?.length ?? 0) < JLM_PAGE) break;
  }
  return out;
}

// ─── מקור ארצי: OpenStreetMap ──────────────────────────────────────

/** סוגי מבנה/שימוש ב-OSM → שם בעברית (כדי שהסיווג יעבוד אותו דבר לכל מקור) */
const OSM_USE: Record<string, string> = {
  school: 'בית ספר', kindergarten: 'גן ילדים', college: 'מוסד חינוך', university: 'מוסד חינוך',
  synagogue: 'בית כנסת', hospital: 'מרכז רפואי', clinic: 'מרפאה', doctors: 'מרפאה',
  retail: 'מסחר', commercial: 'מסחר', supermarket: 'מסחר', mall: 'קניון',
  office: 'משרד', public: 'משרד', civic: 'משרד', government: 'משרד', community_centre: 'מרכז קהילתי',
  library: 'ספרייה', post_office: 'דואר', police: 'משטרה', yeshiva: 'ישיבה', mikveh: 'מקווה',
};

interface OsmElement {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { role: string; geometry?: { lat: number; lon: number }[] }[];
}

const num = (v: string | undefined) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseOsmElement(e: OsmElement): OfficialBuilding | null {
  const geom = e.type === 'way' ? e.geometry : e.members?.find((m) => m.role === 'outer' && m.geometry && m.geometry.length >= 4)?.geometry;
  if (!geom || geom.length < 4) return null;
  const poly = geom.map((g) => [r7(g.lon), r7(g.lat)] as LngLat);
  const last = poly[poly.length - 1]!, first = poly[0]!;
  if (last[0] !== first[0] || last[1] !== first[1]) return null; // רק טבעת סגורה
  poly.pop();
  const t = e.tags ?? {};
  const religionUse = t.amenity === 'place_of_worship' && t.religion === 'jewish' ? 'בית כנסת' : '';
  const typeUse = OSM_USE[t.amenity ?? ''] ?? OSM_USE[t.building ?? ''] ?? OSM_USE[t.shop ? 'retail' : ''] ?? '';
  return {
    id: `osm:${e.type[0]}${e.id}`,
    polygon: poly,
    street: t['addr:street'] ?? '',
    num: num(t['addr:housenumber']),
    apts: num(t['building:flats']),
    floors: num(t['building:levels']),
    entrances: null,
    use: [t.name, religionUse || typeUse].filter(Boolean).join(' · '),
  };
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export async function fetchOsmBuildings(bbox: BBox, fetchFn: FetchFn = fetch): Promise<OfficialBuilding[]> {
  const [w, s, e, n] = bbox;
  const q = `[out:json][timeout:40];(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out geom tags;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const j = (await fetchJsonRetry(fetchFn, url, 'OpenStreetMap', { method: 'POST', body: new URLSearchParams({ data: q }) }, 2, 45_000)) as { elements?: OsmElement[] };
      return (j.elements ?? []).map(parseOsmElement).filter((b): b is OfficialBuilding => !!b);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('OpenStreetMap לא זמין');
}

// ─── בחירת מקור לפי מיקום ──────────────────────────────────────────

export interface GisSource {
  id: string;
  name: string;
  /** עירוני = כתובת+דירות רשמיות; ארצי = צורה בלבד (הכתובת מגיעה מ-GovMap) */
  level: 'municipal' | 'national';
  /** תחום כיסוי משוער; המקור הארצי מכסה הכל */
  extent?: BBox;
  fetchBuildings(bbox: BBox, fetchFn?: FetchFn): Promise<OfficialBuilding[]>;
}

export const GIS_SOURCES: GisSource[] = [
  { id: 'jlm', name: 'עיריית ירושלים', level: 'municipal', extent: [35.09, 31.69, 35.28, 31.88], fetchBuildings: fetchJerusalemBuildings },
  { id: 'osm', name: 'OpenStreetMap', level: 'national', fetchBuildings: fetchOsmBuildings },
];

const within = (b: BBox, ext: BBox) => b[0] >= ext[0] && b[1] >= ext[1] && b[2] <= ext[2] && b[3] <= ext[3];

/**
 * מבני האזור מהמקור הטוב ביותר שזמין: עירוני אם מכסה את האזור והחזיר מבנים,
 * אחרת הבסיס הארצי. כך לקוח בכל עיר מקבל מפה עובדת, ובערים עם שכבה עירונית — גם דירות.
 */
export async function fetchBuildingsFor(bbox: BBox, fetchFn: FetchFn = fetch): Promise<{ source: GisSource; buildings: OfficialBuilding[] }> {
  const national = GIS_SOURCES.find((s) => s.level === 'national')!;
  for (const src of GIS_SOURCES) {
    if (src.level !== 'municipal' || !src.extent || !within(bbox, src.extent)) continue;
    try {
      const buildings = await src.fetchBuildings(bbox, fetchFn);
      if (buildings.length) return { source: src, buildings };
    } catch {
      /* המקור העירוני נפל — ממשיכים לארצי */
    }
  }
  return { source: national, buildings: await national.fetchBuildings(bbox, fetchFn) };
}

// ─── GovMap: נקודת כתובת רשמית ─────────────────────────────────────

export interface GeoHit { text: string; point: LngLat; id: string }

const mercToLngLat = (x: number, y: number): LngLat => [
  (x / 6378137) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI),
];

/**
 * נקודת הכתובת הרשמית. מחזיר רק התאמה מדויקת של מספר הבית — GovMap משלים
 * בחופשיות ("שמואל תמיר 1" → "שמואל תמיר 11"), וזה בדיוק סוג הטעות שאנחנו מתקנים.
 */
export async function geocodeAddress(address: string, city: string, fetchFn: FetchFn = fetch): Promise<GeoHit | null> {
  const want = parseAddress(address);
  if (want.num == null) return null;
  const res = await fetchFn('https://www.govmap.gov.il/api/search-service/autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchText: `${streetTokens(want.street).join(' ')} ${want.num} ${city}`, language: 'he', isAccurate: false, maxResults: 8 }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: { id: string; text: string; type: string; shape?: string }[] };
  for (const r of j.results ?? []) {
    if (r.type !== 'address' || !r.text.includes(city)) continue;
    const got = parseAddress(r.text.replace(city, '').trim());
    if (got.num !== want.num || got.suffix !== want.suffix || !streetMatches(want.street, got.street)) continue;
    const m = r.shape?.match(/POINT\s*\(([\d.]+) ([\d.]+)\)/);
    if (!m) continue;
    return { text: r.text, id: r.id, point: mercToLngLat(Number(m[1]), Number(m[2])) };
  }
  return null;
}

// ─── התאמת בנייני ה-CRM למבנים ─────────────────────────────────────

export type MatchMethod = 'address' | 'geocode' | 'point' | 'manual';

export interface BuildingMatch {
  key: string;
  official: OfficialBuilding | null;
  method: MatchMethod | null;
  /** high = כתובת מאומתת מול מקור רשמי; medium = לפי מיקום בלבד */
  confidence: 'high' | 'medium' | 'none';
  families: number;
  broken: boolean;
  brokenKind: BrokenKind | null;
  /** כתובת בלי מספר בית: לא מסומנת במפה ולא מתוקנת לפי מיקום — ממתינה לעדכון ידני */
  waitingForNumber: boolean;
  /** הצעת כתובת חדשה (לכתובת פגומה) — מפתח קיים או כתובת רשמית */
  renameTo?: string;
  /** הנקודה השמורה לא על המבנה */
  relocate: boolean;
  categoryTo?: string;
  unitsTo?: number;
}

const familiesIn = (apts: Apartment[] | undefined) => (apts ?? []).filter((a) => !a.deletedAt && (a.lastName || a.father || a.mother || a.name)).length;

function refPoint(info: BuildingInfo): LngLat | null {
  const poly = info.polygon as LngLat[] | undefined;
  if (poly && poly.length >= 3) return labelPoint(poly);
  return (info.coords as LngLat | null | undefined) ?? null;
}

/**
 * מתאים כל בניין ב-CRM למבנה רשמי. הכתובת שבכרטיס היא האמת — המיקום במפה
 * נגזר ממנה ולא להפך. סדר האמון:
 * 1. הכתובת מופיעה כרשומת המבנה (העירייה)
 * 2. נקודת הכתובת הרשמית (GovMap) נופלת על מבנה — כניסה נוספת מאומתת
 * 3. המבנה במיקום השמור — רק כשהכתובת לא נמצאה ברישום, ולא מאומת
 * כתובת בלי מספר בית לא ממוקמת בכלל עד שיעודכן מספר.
 */
export function matchBuildings(db: Db, officials: OfficialBuilding[], geo: Record<string, GeoHit | null> = {}): BuildingMatch[] {
  const keys = buildingKeys(db).filter((k) => k !== '__NO_ADDRESS__');
  const out: BuildingMatch[] = [];
  for (const key of keys) {
    const entry = getBuilding(db, key)!;
    const info = entry.info ?? {};
    const ref = refPoint(info);
    const kind = brokenKind(key);
    const broken = kind !== null;
    if (kind === 'nonum') {
      out.push({ key, official: null, method: null, confidence: 'none', families: familiesIn(entry.apts), broken, brokenKind: kind, waitingForNumber: true, relocate: false });
      continue;
    }
    // כתובת עם מילה כפולה עדיין כתובת אמיתית — מחפשים לפי הכתיב המתוקן
    const lookup = kind === 'doubled' ? cleanAddress(key) : kind ? null : key;
    let official: OfficialBuilding | null = null;
    let method: MatchMethod | null = null;

    const byAddr = lookup ? officials.filter((b) => addressMatchesOfficial(lookup, b)) : [];
    if (byAddr.length) {
      official = ref ? byAddr.reduce((a, b) => (distanceToPolygonM(ref, a.polygon) <= distanceToPolygonM(ref, b.polygon) ? a : b)) : byAddr[0]!;
      method = 'address';
    }
    const hit = geo[key];
    if (!official && hit) {
      official = buildingAt(hit.point, officials, 15);
      if (official) method = 'geocode';
    }
    if (!official && ref) {
      official = buildingAt(ref, officials, 12);
      if (official) method = 'point';
    }
    if (info.gisId && (info.gis as GisInfo | undefined)?.method === 'manual') {
      const manual = officials.find((b) => b.id === info.gisId);
      if (manual) { official = manual; method = 'manual'; }
    }

    const m: BuildingMatch = {
      key, official, method, families: familiesIn(entry.apts), broken, brokenKind: kind, waitingForNumber: false,
      confidence: method === 'address' || method === 'geocode' || method === 'manual' ? 'high' : method ? 'medium' : 'none',
      relocate: !!(official && ref && distanceToPolygonM(ref, official.polygon) > 0),
    };
    if (official) {
      const cat = categoryFromUse(official.use);
      if (cat && (!info.category || info.category === 'residential') && cat !== info.category) m.categoryTo = cat;
      else if (!info.category && official.apts) m.categoryTo = 'residential';
    }
    out.push(m);
  }

  // כמה כתובות על אותו מבנה = כניסות; דירות של העירייה הן לכל המבנה, לכן ממלאים רק כשיש כתובת אחת
  const perBuilding = new Map<string, number>();
  for (const m of out) if (m.official) perBuilding.set(m.official.id, (perBuilding.get(m.official.id) ?? 0) + 1);
  for (const m of out) {
    if (!m.official) continue;
    const units = getBuilding(db, m.key)!.info.units as { count?: number; source?: string } | undefined;
    if (perBuilding.get(m.official.id) === 1 && m.official.apts && !units?.count) m.unitsTo = m.official.apts;
    if (m.brokenKind === 'doubled') m.renameTo = cleanAddress(m.key);
    else if (m.broken) {
      // כתובת משובשת/בלי מספר: לפי המיקום — כתובת קיימת על אותו בניין, אחרת הכתובת הרשמית
      const sibling = out.find((o) => o !== m && !o.broken && o.official?.id === m.official!.id);
      m.renameTo = sibling?.key ?? preferredAddress(db, m.official);
    }
  }
  return out;
}

/** תיקון בטוח לביצוע גורף: מאומת מול מקור רשמי, או בלי משפחות */
export function isAutoSafe(m: BuildingMatch): boolean {
  if (!m.official) return false;
  if (m.confidence === 'high') return true;
  return m.families === 0;
}

// ─── החלה על הנתונים ───────────────────────────────────────────────

/** קישור בניין למבנה: מזהה, צורה רשמית, נקודה בתוך המבנה, נתונים רשמיים */
export function linkBuilding(db: Db, key: string, b: OfficialBuilding, method: MatchMethod, opts: { entrance?: LngLat; units?: number; category?: string } = {}): void {
  const entry = getBuilding(db, key);
  if (!entry) return;
  const now = Date.now();
  const info: BuildingInfo = { ...entry.info };
  info.gisId = b.id;
  info.gis = { id: b.id, street: b.street, num: b.num, apts: b.apts, floors: b.floors, entrances: b.entrances, use: b.use, method, at: now } satisfies GisInfo;
  info.polygon = b.polygon;
  const coords = info.coords as LngLat | null | undefined;
  info.coords = opts.entrance && distanceToPolygonM(opts.entrance, b.polygon) <= 15 ? opts.entrance
    : coords && pointInPolygon(coords, b.polygon) ? coords : labelPoint(b.polygon);
  info._coordSource = 'gis';
  if (opts.category) info.category = opts.category;
  if (opts.units) {
    const prev = (info.units ?? {}) as Record<string, unknown>;
    info.units = { ...prev, source: 'CITY', count: opts.units, cityCount: b.apts, citySource: b.id.split(':')[0], cityUpdatedAt: now, floors: b.floors, entrances: b.entrances };
  }
  info.updatedAt = now;
  entry.info = info;
}

/**
 * העברת בניין לכתובת אחרת. המפתח הישן נשאר כמצבה (movedTo) — אחרת סנכרון
 * עם עותק ישן בדרייב היה מחזיר אותו (המיזוג מאחד בניינים).
 */
export function moveBuilding(db: Db, from: string, to: string): void {
  if (from === to) return;
  const src = getBuilding(db, from);
  if (!src) return;
  const now = Date.now();
  const dst = getBuilding(db, to);
  if (dst) {
    const ids = new Set(dst.apts.map((a) => a.id).filter(Boolean));
    dst.apts.push(...src.apts.filter((a) => !a.deletedAt && !(a.id && ids.has(a.id))).map((a) => ({ ...a, updatedAt: now })));
    dst.info = { ...src.info, ...dst.info, updatedAt: now };
  } else {
    db[to] = { info: { ...src.info, updatedAt: now }, apts: src.apts.map((a) => ({ ...a, updatedAt: now })) };
  }
  db[from] = { info: { movedTo: to, deletedAt: now, updatedAt: now }, apts: [] };
}

/** האם הבניין "חי" (לא הועבר/נמחק) */
export function isLiveBuilding(info: BuildingInfo | undefined): boolean {
  return !info?.movedTo && !info?.deletedAt;
}

// ─── שכבת המפה ─────────────────────────────────────────────────────

/** אינדקס: מבנה רשמי ← כתובות ה-CRM שמקושרות אליו */
export function linkedKeysByBuilding(db: Db): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const k of buildingKeys(db)) {
    const id = getBuilding(db, k)?.info.gisId;
    if (typeof id !== 'string') continue;
    const arr = map.get(id) ?? [];
    arr.push(k);
    map.set(id, arr);
  }
  return map;
}

export function territoryPolygon(db: Db): LngLat[] | undefined {
  return getTerritory(db).polygon as LngLat[] | undefined;
}

/**
 * הכתובת שבה ייקרא בניין חדש: שם הרחוב כפי שהמשתמש כבר כותב אותו
 * ("שמואל תמיר 23" ולא "שמואל תמיר כצנלסון 23"), אחרת השם הרשמי.
 */
export function preferredAddress(db: Db, b: Pick<OfficialBuilding, 'street' | 'num'>): string {
  if (!b.num) return b.street;
  const counts = new Map<string, number>();
  for (const k of buildingKeys(db)) {
    if (isBrokenAddress(k)) continue;
    const p = parseAddress(k);
    if (streetMatches(p.street, b.street)) counts.set(p.street, (counts.get(p.street) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return `${best ?? b.street} ${b.num}`;
}

// ─── רשימת תיקונים ─────────────────────────────────────────────────

export interface MapFix {
  key: string;
  match: BuildingMatch;
  /** קישור/עדכון צורה מול המבנה הרשמי */
  link: boolean;
  relocate: boolean;
  renameTo?: string;
  category?: string;
  units?: number;
  /** נקודת כניסה רשמית (GovMap) — הנקודה של הכתובת על המבנה */
  entrance?: LngLat;
  /** true = נדרשת החלטה של המשתמש (יש משפחות ואין אימות רשמי, או אין מבנה בכלל) */
  needsUser: boolean;
}

const samePoly = (a: unknown, b: LngLat[]) => JSON.stringify(a) === JSON.stringify(b);

/** מה עוד צריך לתקן — ריק כשהמפה מדויקת */
export function pendingFixes(db: Db, matches: BuildingMatch[], geo: Record<string, GeoHit | null> = {}): MapFix[] {
  const out: MapFix[] = [];
  for (const m of matches) {
    const info = getBuilding(db, m.key)?.info;
    if (!info || m.waitingForNumber) continue;
    if (!m.official) {
      out.push({ key: m.key, match: m, link: false, relocate: false, needsUser: true });
      continue;
    }
    const link = info.gisId !== m.official.id || !samePoly(info.polygon, m.official.polygon);
    const fix: MapFix = {
      key: m.key, match: m, link, relocate: m.relocate, renameTo: m.renameTo, category: m.categoryTo, units: m.unitsTo,
      entrance: m.method === 'geocode' ? geo[m.key]?.point : undefined,
      // תיקון כתיב של כתובת מאומתת בטוח; העברה לפי מיקום עם משפחות — רק באישור
      needsUser: m.families > 0 && (m.confidence !== 'high' || (!!m.renameTo && m.brokenKind !== 'doubled')),
    };
    if (fix.link || fix.relocate || fix.renameTo || fix.category || fix.units) out.push(fix);
  }
  return out;
}

/** מחיל תיקון אחד. החלטה ידנית (manual) נשמרת ולא תידרס בבדיקה הבאה */
export function applyFix(db: Db, fix: MapFix, opts: { manual?: boolean; skipRename?: boolean } = {}): string {
  const b = fix.match.official;
  if (!b) return fix.key;
  let key = fix.key;
  if (fix.renameTo && !opts.skipRename) {
    moveBuilding(db, fix.key, fix.renameTo);
    key = fix.renameTo;
  }
  linkBuilding(db, key, b, opts.manual ? 'manual' : fix.match.method ?? 'point', { entrance: fix.entrance, units: fix.units, category: fix.category });
  return key;
}

/** קישור ידני: המשתמש בחר מבנה לכתובת */
export function linkManually(db: Db, key: string, b: OfficialBuilding): void {
  linkBuilding(db, key, b, 'manual');
}
