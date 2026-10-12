/**
 * הפיכת הנתונים לשכבות מפה: כל מבנה רשמי = פוליגון אחד, צבוע לפי המצב שנבחר.
 * המבנים של Mapbox מוסתרים — מה שרואים על המפה הוא בדיוק מה שנלחץ ונשמר.
 */
import {
  type Apartment, type BuildingMatch, type Db, type LngLat, type OfficialBuilding,
  categoryFromUse, displayName, getBuilding, getCategories, getStatusColor, labelPoint,
  liveApts, polygonInTerritory, statusSeverity, territoryPolygon,
} from '@shlichus/core';

export type ColorMode = 'status' | 'category' | 'coverage';

export interface Palette {
  empty: string; outside: string; line: string; selected: string; accent: string;
  sev: [string, string, string, string]; coverage: [string, string]; text: string; halo: string; surface: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
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
  b: OfficialBuilding;
  keys: string[];
  families: { key: string; apt: Apartment; idx: number }[];
  severity: number;
  apts: number | null;
  category: string | null;
  inTerritory: boolean;
  match: BuildingMatch | null;
}

/** תצוגה מאוחדת לכל מבנה: הכתובות שעליו, המשפחות, הסיווג והתיחום */
export function buildViews(db: Db, buildings: OfficialBuilding[], matches: BuildingMatch[]): Map<string, BuildingView> {
  const terr = territoryPolygon(db);
  const views = new Map<string, BuildingView>();
  for (const b of buildings) {
    views.set(b.id, { b, keys: [], families: [], severity: -1, apts: b.apts, category: null, inTerritory: polygonInTerritory(b.polygon, terr), match: null });
  }
  for (const m of matches) {
    if (!m.official) continue;
    const v = views.get(m.official.id);
    if (!v) continue;
    v.keys.push(m.key);
    v.match ??= m;
    const entry = getBuilding(db, m.key)!;
    entry.apts.forEach((apt, idx) => {
      if (apt.deletedAt || !displayName(apt)) return;
      v.families.push({ key: m.key, apt, idx });
      v.severity = Math.max(v.severity, statusSeverity(getStatusColor(apt, db.__SETTINGS__)));
    });
    v.category ??= (entry.info.category as string | undefined) ?? null;
    const units = (entry.info.units as { count?: number; source?: string } | undefined);
    if (units?.source === 'VERIFIED' && units.count) v.apts = units.count;
  }
  for (const v of views.values()) {
    v.keys.sort((a, c) => (getBuilding(db, c)!.apts.length - getBuilding(db, a)!.apts.length));
    v.category ??= categoryFromUse(v.b.use) ?? (v.b.apts ? 'residential' : null);
  }
  return views;
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
    const ring = [...v.b.polygon, v.b.polygon[0]!];
    const props = {
      id: v.b.id,
      color: colorFor(v, mode, pal, catColors),
      h: Math.max(1, v.b.floors ?? 2) * 3.2,
      inT: v.inTerritory ? 1 : 0,
      fam: v.families.length,
      num: v.b.num ? String(v.b.num) : '',
    };
    shapes.push({ type: 'Feature', id: v.b.id, properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
    labels.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: labelPoint(v.b.polygon) } });
  }
  return { shapes: { type: 'FeatureCollection', features: shapes }, labels: { type: 'FeatureCollection', features: labels } };
}

/** כתובות ב-CRM שלא נמצא להן מבנה — מוצגות כנקודות אזהרה */
export function orphansGeoJson(db: Db, matches: BuildingMatch[]): FC {
  const features: GeoJSON.Feature[] = [];
  for (const m of matches) {
    if (m.official) continue;
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
