/**
 * הפיכת הנתונים לשכבות מפה: כל מבנה רשמי = פוליגון אחד (או חלק לכל כניסה), צבוע לפי המצב שנבחר.
 * המבנים של Mapbox מוסתרים — מה שרואים על המפה הוא בדיוק מה שנלחץ ונשמר.
 */
import type mapboxgl from 'mapbox-gl';
import { isDark } from '../themeMode';
import {
  type Apartment, type BuildingMatch, type Db, type GeoHit, type LngLat, type MapUnit, type OfficialBuilding,
  categoryFromUse, displayName, getBuilding, getCategories, getStatusColor, labelPoint,
  liveApts, parseAddress, polygonInTerritory, statusSeverity, territoryPolygon, unitsForBuilding,
} from '@shlichus/core';

export type ColorMode = 'status' | 'category' | 'coverage';

export interface Palette {
  empty: string; outside: string; line: string; selected: string; accent: string;
  sev: [string, string, string, string]; coverage: [string, string]; text: string; halo: string; surface: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const dark = isDark();
  return {
    empty: dark ? '#3a4744' : '#cfd8d5',
    outside: dark ? '#252e2c' : '#e6ebe9',
    line: dark ? '#0f1514' : '#9aa8a4',
    selected: v('--accent'),
    accent: v('--accent'),
    // אפור = אין קשר מעולם · ירוק = בקשר · כתום = מתרחק · אדום = צריך תשומת לב
    sev: [v('--cold'), v('--ok'), v('--warm'), v('--hot')],
    coverage: [dark ? '#1d3a36' : '#d6ece8', v('--accent')],
    text: v('--fg'),
    halo: v('--surface'),
    surface: v('--surface'),
  };
}

/** משפחה = דירה חיה עם שם */
export const families = (apts: Apartment[] | undefined) => liveApts(apts).filter((a) => !!displayName(a));

export interface BuildingView {
  /** מזהה היחידה במפה: בניין שלם, או "<מבנה>#<כתובת>" לכניסה */
  id: string;
  b: OfficialBuilding;
  polygon: LngLat[];
  keys: string[];
  /** כתובות שלך בכניסות האחרות של אותו בניין */
  siblings: string[];
  families: { key: string; apt: Apartment; idx: number }[];
  severity: number;
  apts: number | null;
  aptsSource: MapUnit['aptsSource'];
  category: string | null;
  inTerritory: boolean;
  match: BuildingMatch | null;
}

/**
 * תצוגה לכל יחידה במפה. בניין עם כמה כתובות שלך מתחלק לכניסות (לפי נקודות
 * הכתובת הרשמיות), כך שכל כניסה נלחצת, נצבעת ומציגה את המשפחות שלה.
 */
export function buildViews(db: Db, buildings: OfficialBuilding[], matches: BuildingMatch[], geo: Record<string, GeoHit | null>): Map<string, BuildingView> {
  const terr = territoryPolygon(db);
  const keysBy = new Map<string, string[]>();
  const matchBy = new Map<string, BuildingMatch>();
  for (const m of matches) {
    if (!m.official) continue;
    matchBy.set(m.key, m);
    keysBy.set(m.official.id, [...(keysBy.get(m.official.id) ?? []), m.key]);
  }
  const famCount = (k: string) => families(getBuilding(db, k)?.apts).length;
  const views = new Map<string, BuildingView>();
  for (const b of buildings) {
    const keys = (keysBy.get(b.id) ?? []).sort((a, c) => famCount(c) - famCount(a));
    for (const u of unitsForBuilding(db, b, keys, geo)) {
      const v: BuildingView = {
        id: u.id, b, polygon: u.polygon, keys: u.keys, siblings: u.siblings, families: [], severity: -1,
        apts: u.apts, aptsSource: u.aptsSource, category: null, inTerritory: polygonInTerritory(u.polygon, terr),
        match: u.keys[0] ? matchBy.get(u.keys[0]) ?? null : null,
      };
      for (const key of u.keys) {
        const entry = getBuilding(db, key)!;
        entry.apts.forEach((apt, idx) => {
          if (apt.deletedAt || !displayName(apt)) return;
          v.families.push({ key, apt, idx });
          v.severity = Math.max(v.severity, statusSeverity(getStatusColor(apt, db.__SETTINGS__)));
        });
        v.category ??= (entry.info.category as string | undefined) ?? null;
      }
      v.category ??= categoryFromUse(b.use) ?? (b.apts ? 'residential' : null);
      views.set(v.id, v);
    }
  }
  return views;
}

/** היחידה שמציגה כתובת מסוימת, או בניין לפי המזהה הרשמי שלו */
export function findView(views: Map<string, BuildingView>, target: { id?: string; key?: string }): BuildingView | null {
  if (target.id) return views.get(target.id) ?? [...views.values()].find((v) => v.b.id === target.id) ?? null;
  if (target.key) return [...views.values()].find((v) => v.keys.includes(target.key!)) ?? null;
  return null;
}

function colorFor(v: BuildingView, mode: ColorMode, pal: Palette, catColors: Map<string, string>): string {
  if (mode === 'category') return (v.category && catColors.get(v.category)) || (v.inTerritory ? pal.empty : pal.outside);
  if (mode === 'coverage') {
    if (!v.apts) return v.families.length ? pal.coverage[1] : v.inTerritory ? pal.empty : pal.outside;
    const r = Math.min(1, v.families.length / v.apts);
    return r === 0 ? (v.inTerritory ? pal.empty : pal.outside) : mix(pal.coverage[0], pal.coverage[1], 0.25 + r * 0.75);
  }
  if (v.families.length) return pal.sev[Math.max(0, v.severity)] ?? pal.sev[0];
  return v.inTerritory ? pal.empty : pal.outside;
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

type FC = GeoJSON.FeatureCollection;

export function toGeoJson(db: Db, views: Map<string, BuildingView>, mode: ColorMode, pal: Palette): { shapes: FC; labels: FC } {
  const catColors = new Map(getCategories(db).map((c) => [c.id, c.color]));
  const shapes: GeoJSON.Feature[] = [];
  const labels: GeoJSON.Feature[] = [];
  for (const v of views.values()) {
    const ring = [...v.polygon, v.polygon[0]!];
    // המספר שעל השלט: של הכתובת שלך, ורק בלעדיה — של הרישום
    const signNum = v.keys[0] ? parseAddress(v.keys[0]).num : v.b.num;
    const props = {
      id: v.id,
      color: colorFor(v, mode, pal, catColors),
      h: Math.max(1, v.b.floors ?? 2) * 3.2,
      inT: v.inTerritory ? 1 : 0,
      fam: v.families.length,
      num: signNum ? String(signNum) : '',
    };
    shapes.push({ type: 'Feature', id: v.id, properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
    labels.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: labelPoint(v.polygon) } });
  }
  return { shapes: { type: 'FeatureCollection', features: shapes }, labels: { type: 'FeatureCollection', features: labels } };
}

/** כתובות ב-CRM שלא נמצא להן מבנה — מוצגות כנקודות אזהרה */
export function orphansGeoJson(db: Db, matches: BuildingMatch[]): FC {
  const features: GeoJSON.Feature[] = [];
  for (const m of matches) {
    if (m.official || m.waitingForNumber) continue; // בלי מספר בית — לא מסמנים במפה
    const c = getBuilding(db, m.key)?.info.coords as LngLat | null | undefined;
    if (!c) continue;
    features.push({ type: 'Feature', properties: { key: m.key, fam: m.families }, geometry: { type: 'Point', coordinates: c } });
  }
  return { type: 'FeatureCollection', features };
}

/** מסכה סביב התיחום: מחשיך את מה שמחוצה לו */
export function territoryMask(db: Db): FC {
  const t = territoryPolygon(db);
  if (!t || t.length < 3) return { type: 'FeatureCollection', features: [] };
  const ring = [...t, t[0]!];
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'mask' }, geometry: { type: 'Polygon', coordinates: [world, ring] } },
      { type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: ring } },
    ],
  };
}

/** בסיס המפה: מסתיר את הבניינים של Mapbox (מוצגים רק המבנים שלנו) ומציג שמות בשם המקומי (עברית) */
export function prepareBaseMap(map: mapboxgl.Map): void {
  for (const l of map.getStyle().layers ?? []) {
    if ((l as { 'source-layer'?: string })['source-layer'] === 'building') map.setLayoutProperty(l.id, 'visibility', 'none');
    if (l.type === 'symbol') {
      const tf = map.getLayoutProperty(l.id, 'text-field');
      if (tf && JSON.stringify(tf).includes('name_en')) map.setLayoutProperty(l.id, 'text-field', JSON.parse(JSON.stringify(tf).replace(/"name_en"/g, '"name"')));
    }
  }
}
