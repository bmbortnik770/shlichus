import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { type Db, getTerritory, pointInPolygon } from '@shlichus/core';
import { useCrm } from './store';

/** עורך תיחום — מודל נפרד עם מפה משלו, כמו territoryMapEditorModal בישן.
    כולל זיהוי בתים חי בתוך התיחום (tmCountBuildings) ושמירת collectedBuildings. */

function buildingKey(center: [number, number]): string {
  // אותו מפתח כמו tmBuildingKey בישן
  return center[0].toFixed(5) + ',' + center[1].toFixed(5);
}

function featureCenter(f: { geometry?: { type?: string; coordinates?: unknown } }): [number, number] | null {
  const g = f.geometry;
  if (!g?.coordinates) return null;
  const ring = (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][][][])[0]?.[0]) as number[][] | undefined;
  if (!ring?.length) return null;
  const lng = ring.reduce((s, p) => s + p[0]!, 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
  return [lng, lat];
}

/** שטח פוליגון בקמ"ר (נוסחת גאוס בקירוב מטרי) */
function areaKm2(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const R = 6371;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    area += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

export function TerritoryEditor({ db, onClose }: { db: Db; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pointsRef = useRef<[number, number][]>([]);
  const collectedRef = useRef<Record<string, { center: [number, number] }>>({});
  const [pointCount, setPointCount] = useState(0);
  const [bldgCount, setBldgCount] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const updateSettings = useCrm((s) => s.updateSettings);
  const territory = getTerritory(db);

  const renderDraw = (map: mapboxgl.Map) => {
    const pts = pointsRef.current;
    const src = map.getSource('tm-draw') as mapboxgl.GeoJSONSource | undefined;
    const data = pts.length >= 3
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[...pts, pts[0]!]] } }
      : { type: 'FeatureCollection' as const, features: [] };
    if (src) src.setData(data as never);
  };

  /** זיהוי בתים בתיחום — כמו tmCountBuildings: צביעה ירוק/אפור + ספירה */
  const countBuildings = (map: mapboxgl.Map) => {
    const pts = pointsRef.current;
    if (pts.length < 3) { setBldgCount(0); return; }
    const polygon: [number, number][] = [...pts, pts[0]!];
    const features = map.queryRenderedFeatures(undefined, { layers: ['tm-buildings'] });
    const seen = new Set<string>();
    const collected: Record<string, { center: [number, number] }> = {};
    let count = 0;
    for (const f of features as unknown as { id?: string | number; geometry?: unknown }[]) {
      const center = featureCenter(f as never);
      if (!center) continue;
      const key = buildingKey(center);
      if (seen.has(key)) continue;
      seen.add(key);
      const inside = pointInPolygon(center, polygon);
      if (f.id !== undefined) {
        map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: f.id }, { in: inside });
      }
      if (inside) { count++; collected[key] = { center }; }
    }
    collectedRef.current = collected;
    setBldgCount(count);
  };

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const home = (db.__SETTINGS__?.homeLocation ?? {}) as { coords?: [number, number] };
    const existing = (territory.polygon ?? []) as [number, number][];
    if (existing.length >= 3) {
      // טען תיחום קיים לעריכה (בלי נקודת הסגירה)
      pointsRef.current = existing[0]![0] === existing[existing.length - 1]![0] &&
        existing[0]![1] === existing[existing.length - 1]![1]
        ? existing.slice(0, -1) : [...existing];
      setPointCount(pointsRef.current.length);
    }

    const map = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: pointsRef.current[0] ?? home.coords ?? [35.2443, 31.8265],
      zoom: 16,
      pitch: 0,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    mapRef.current = map;
    (window as unknown as { __tmMap?: mapboxgl.Map }).__tmMap = map; // לבדיקות

    map.on('style.load', () => {
      // שכבת הדגשת בניינים — ירוק בתיחום, אפור בחוץ (כמו tm-buildings-highlight)
      if (!map.getLayer('tm-buildings')) {
        map.addLayer({
          id: 'tm-buildings', source: 'composite', 'source-layer': 'building',
          filter: ['==', 'extrude', 'true'], type: 'fill', minzoom: 14,
          paint: {
            'fill-color': ['case', ['boolean', ['feature-state', 'in'], false], '#10b981', '#94a3b8'],
            'fill-opacity': 0.55,
          },
        });
      }
      if (!map.getSource('tm-draw')) {
        map.addSource('tm-draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'tm-draw-fill', type: 'fill', source: 'tm-draw', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'tm-draw-line', type: 'line', source: 'tm-draw', paint: { 'line-color': '#3b82f6', 'line-width': 2.5, 'line-dasharray': [5, 3] } });
      }
      renderDraw(map);
      setTimeout(() => countBuildings(map), 800);
    });

    map.on('click', (e) => {
      pointsRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      setPointCount(pointsRef.current.length);
      renderDraw(map);
      // ספירה חיה עם debounce כמו בישן (800ms)
      clearTimeout((window as unknown as { __tmT?: number }).__tmT);
      (window as unknown as { __tmT?: number }).__tmT = window.setTimeout(() => countBuildings(map), 800);
    });
    map.on('moveend', () => { if (pointsRef.current.length >= 3) countBuildings(map); });
    map.getCanvas().style.cursor = 'crosshair';

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undoPoint = () => {
    pointsRef.current.pop();
    setPointCount(pointsRef.current.length);
    if (mapRef.current) { renderDraw(mapRef.current); countBuildings(mapRef.current); }
  };

  const clearAll = () => {
    pointsRef.current = [];
    setPointCount(0);
    setBldgCount(0);
    if (mapRef.current) renderDraw(mapRef.current);
  };

  const save = async () => {
    const pts = pointsRef.current;
    if (pts.length < 3) { window.alert('צריך לפחות 3 נקודות לתיחום'); return; }
    const ring: [number, number][] = [...pts, pts[0]!];
    // שמירה כמו הישן: polygon + מיזוג collectedBuildings (לא דורס קיימים)
    await updateSettings({
      territory: {
        ...territory,
        polygon: ring,
        displayMode: territory.displayMode ?? 'border',
        collectedBuildings: {
          ...((territory.collectedBuildings ?? {}) as Record<string, unknown>),
          ...collectedRef.current,
        },
      },
    });
    onClose();
  };

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !satellite;
    map.setStyle(next ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/streets-v12');
    setSatellite(next);
  };

  const km2 = areaKm2(pointsRef.current);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="tm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head" style={{ padding: '14px 18px 8px' }}>
          <h2><i className="fas fa-draw-polygon" style={{ color: 'var(--accent)', marginInlineEnd: 8 }} />עורך תיחום השליחות</h2>
          <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
        </header>
        <div className="tm-bar">
          <span className="filter-pill" style={{ cursor: 'default' }}>{pointCount} נקודות</span>
          <span className="filter-pill" style={{ cursor: 'default', color: 'var(--success)' }}>
            <i className="fas fa-home" /> {bldgCount} מבנים בתיחום
          </span>
          {km2 > 0 && (
            <span className="filter-pill" style={{ cursor: 'default' }}>
              {km2 < 1 ? (km2 * 100).toFixed(1) + ' דונם' : km2.toFixed(2) + ' קמ״ר'}
            </span>
          )}
          <button className="map-ctl-btn" onClick={undoPoint} disabled={!pointCount}><i className="fas fa-undo" /> בטל נקודה</button>
          <button className="map-ctl-btn" onClick={clearAll}><i className="fas fa-eraser" /> נקה</button>
          <button className="map-ctl-btn" onClick={toggleSat}><i className={`fas ${satellite ? 'fa-map' : 'fa-satellite'}`} /></button>
          <button className="map-ctl-btn primary" onClick={() => void save()}><i className="fas fa-check" /> שמירת תיחום</button>
        </div>
        <div ref={container} className="tm-map" />
        <p className="tpl-text" style={{ padding: '8px 18px' }}>
          לחץ על המפה להוספת נקודות תיחום — מבנים בפנים נצבעים ירוק ונספרים אוטומטית.
        </p>
      </div>
    </div>
  );
}
