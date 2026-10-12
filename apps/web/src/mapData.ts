import { create } from 'zustand';
import {
  type BBox, type BuildingMatch, type Db, type GeoHit, type GisSource, type LngLat, type OfficialBuilding,
  GIS_SOURCES, addressMatchesOfficial, bboxOf, buildingKeys, cacheGet, cachePut, fetchBuildingsFor, geocodeAddress,
  brokenKind, cleanAddress, getBuilding, matchBuildings, territoryPolygon,
} from '@shlichus/core';

/** העיר של השליחות — לחיפוש כתובות רשמי */
export function missionCity(db: Db): string {
  const s = db.__SETTINGS__ ?? {};
  if (typeof s.city === 'string' && s.city.trim()) return s.city.trim();
  for (const loc of [s.homeLocation, s.primaryLocation] as { address?: string }[]) {
    const parts = String(loc?.address ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1]!;
  }
  return '';
}

/** אזור העבודה: התיחום + כל הבניינים השמורים, עם שוליים */
export function missionArea(db: Db): BBox | null {
  const pts: LngLat[] = [...(territoryPolygon(db) ?? [])];
  for (const k of buildingKeys(db)) {
    const c = getBuilding(db, k)?.info.coords as LngLat | null | undefined;
    if (c) pts.push(c);
  }
  const home = (db.__SETTINGS__?.homeLocation as { coords?: LngLat } | undefined)?.coords;
  if (home) pts.push(home);
  return pts.length ? bboxOf(pts, 150) : null;
}

const CACHE_DAYS = 30;
const CACHE_KEY = 'gis:mission';
const covers = (a: BBox, b: BBox) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];

interface Cached { area: BBox; at: number; sourceId: string; sourceName: string; level: GisSource['level']; buildings: OfficialBuilding[] }

interface MapDataState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  buildings: OfficialBuilding[];
  source: { id: string; name: string; level: GisSource['level'] } | null;
  fetchedAt: number | null;
  geo: Record<string, GeoHit | null>;
  checking: boolean;
  load: (db: Db, force?: boolean) => Promise<void>;
  /** מאמת ב-GovMap רק כתובות שלא נמצאו ישירות במקור — ושומר במטמון */
  verify: (db: Db) => Promise<BuildingMatch[]>;
}

export const useMapData = create<MapDataState>((set, get) => ({
  status: 'idle',
  error: null,
  buildings: [],
  source: null,
  fetchedAt: null,
  geo: {},
  checking: false,

  load: async (db, force = false) => {
    const area = missionArea(db);
    if (!area) { set({ status: 'ready', buildings: [] }); return; }
    set({ status: get().buildings.length ? 'ready' : 'loading', error: null });
    // עותק אחד לשליחות: תקף כל עוד הוא מכסה את האזור (בניין חדש בתוך האזור לא מחייב הורדה מחדש)
    const stored = await cacheGet<Cached>(CACHE_KEY);
    const cached = stored?.area && covers(stored.area, area) ? stored : null;
    if (cached) {
      set({ buildings: cached.buildings, source: { id: cached.sourceId, name: cached.sourceName, level: cached.level }, fetchedAt: cached.at, status: 'ready' });
      // עותק טרי מהמקור הטוב ביותר — אין צורך בהורדה. עותק ארצי באזור שיש בו מקור עירוני
      // (כי העירוני לא ענה בפעם הקודמת) — מנסים שוב את העירוני ברקע בכל טעינה
      const betterExists = cached.level === 'national' && GIS_SOURCES.some((g) => g.level === 'municipal' && g.extent && covers(g.extent, area));
      if (!force && !betterExists && Date.now() - cached.at < CACHE_DAYS * 86400000) return;
    }
    try {
      // מורידים עם שוליים, כדי שהרחבה קטנה של האזור לא תחייב הורדה חוזרת
      const wide = bboxOf([[area[0], area[1]], [area[2], area[3]]], 250);
      const { source, buildings } = await fetchBuildingsFor(wide);
      const entry: Cached = { area: wide, at: Date.now(), sourceId: source.id, sourceName: source.name, level: source.level, buildings };
      await cachePut(CACHE_KEY, entry);
      set({ buildings, source: { id: source.id, name: source.name, level: source.level }, fetchedAt: entry.at, status: 'ready' });
    } catch (e) {
      // יש עותק? ממשיכים איתו בשקט. אין? מציגים את הבעיה
      if (!cached) set({ status: 'error', error: e instanceof Error ? e.message : 'טעינת המבנים נכשלה' });
    }
  },

  verify: async (db) => {
    const { buildings } = get();
    const city = missionCity(db);
    set({ checking: true });
    const geo = { ...(await cacheGet<Record<string, GeoHit | null>>(`geo:${city}`)) ?? {}, ...get().geo };
    if (city) {
      // כתובת בכתיב כפול ("דוד ניב ניב 18") נבדקת לפי הכתיב המתוקן; בלי מספר או משובשת — אין מה לבדוק
      const need = buildingKeys(db).filter((k) => {
        const kind = brokenKind(k);
        if (k in geo || kind === 'garbled' || kind === 'nonum') return false;
        const addr = kind === 'doubled' ? cleanAddress(k) : k;
        return !buildings.some((b) => addressMatchesOfficial(addr, b));
      });
      for (const k of need) {
        try { geo[k] = await geocodeAddress(k, city); } catch { /* רשת — ננסה בפעם הבאה */ }
        await new Promise((r) => setTimeout(r, 120));
      }
      await cachePut(`geo:${city}`, geo);
    }
    set({ geo, checking: false });
    return matchBuildings(db, buildings, geo);
  },
}));
