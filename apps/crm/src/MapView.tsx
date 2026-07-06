import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  type Db,
  buildingKeys,
  categoryColor,
  getBuilding,
  getTerritory,
  liveApts,
  pointInPolygon,
} from '@shlichus/core';
import { useCrm } from './store';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';

type ColorMode = 'style' | 'category' | 'territory';

interface MarkerInfo {
  key: string;
  coords: [number, number];
  families: number;
  el: HTMLButtonElement;
}

// אותה פלטת צבעי סגנון כמו במערכת הקיימת (getColorForString)
const CHART_STYLE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];

function styleColor(db: Db, style: string | undefined): string {
  if (!style) return '#94a3b8';
  const custom = (db.__SETTINGS__?.styleColors ?? {}) as Record<string, string>;
  if (custom[style]) return custom[style];
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];
  const idx = styles.indexOf(style);
  return idx === -1 ? '#94a3b8' : CHART_STYLE_COLORS[idx % CHART_STYLE_COLORS.length]!;
}

function markerColor(db: Db, key: string, mode: ColorMode): string {
  const entry = getBuilding(db, key);
  if (!entry) return '#94a3b8';
  if (mode === 'category') {
    return categoryColor(db, String(entry.info?.categoryId ?? entry.info?.category ?? '') || undefined);
  }
  if (mode === 'territory') {
    const poly = getTerritory(db).polygon;
    if (!poly || !entry.info?.coords) return '#94a3b8';
    return pointInPolygon(entry.info.coords as [number, number], poly) ? '#10b981' : '#94a3b8';
  }
  const apts = liveApts(entry.apts);
  const counts = new Map<string, number>();
  apts.forEach((a) => { if (a.style) counts.set(a.style, (counts.get(a.style) ?? 0) + 1); });
  const dominant = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return styleColor(db, dominant);
}

export function MapView({ db, onOpenBuilding }: { db: Db; onOpenBuilding: (key: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<MarkerInfo[]>([]);
  const drawPointsRef = useRef<[number, number][]>([]);
  const [failed, setFailed] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('style');
  const [drawing, setDrawing] = useState(false);
  const [drawCount, setDrawCount] = useState(0);
  const updateSettings = useCrm((s) => s.updateSettings);

  const territory = getTerritory(db);

  /** ציור/עדכון שכבת הטריטוריה — קו מקווקו כחול כמו בישן */
  const renderTerritory = (map: mapboxgl.Map, coords: [number, number][] | undefined) => {
    const draw = () => {
      const src = map.getSource('territory-source') as mapboxgl.GeoJSONSource | undefined;
      if (!coords || coords.length < 3) {
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      const ring = [...coords];
      if (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) ring.push(ring[0]!);
      const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
      if (src) src.setData(data);
      else {
        map.addSource('territory-source', { type: 'geojson', data });
        map.addLayer({ id: 'territory-fill', type: 'fill', source: 'territory-source', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.06 } });
        map.addLayer({ id: 'territory-line', type: 'line', source: 'territory-source', paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [5, 3] } });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once('idle', draw);
  };

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: mapboxgl.Map;
    try {
      const withCoords = buildingKeys(db)
        .map((k) => getBuilding(db, k)?.info?.coords)
        .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2 && !isNaN(c[0]!));
      map = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: withCoords[0] ?? [34.989, 32.794],
        zoom: 14,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl(), 'top-left');
      mapRef.current = map;

      markersRef.current = [];
      for (const key of buildingKeys(db)) {
        const entry = getBuilding(db, key);
        const c = entry?.info?.coords;
        if (!c || !Array.isArray(c) || c.length !== 2 || isNaN(c[0]!)) continue;
        const el = document.createElement('button');
        el.className = 'map-marker';
        el.textContent = String(liveApts(entry!.apts).length || '');
        el.title = key;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onOpenBuilding(key);
        });
        new mapboxgl.Marker({ element: el }).setLngLat(c as [number, number]).addTo(map);
        markersRef.current.push({ key, coords: c as [number, number], families: 0, el });
      }
      markersRef.current.forEach((m) => { m.el.style.background = markerColor(db, m.key, 'style'); });

      if (withCoords.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        withCoords.forEach((c) => bounds.extend(c));
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
      }

      renderTerritory(map, territory.polygon);
    } catch (e) {
      console.error('map init failed', e);
      setFailed(true);
      return;
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // אתחול חד-פעמי בכוונה
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // צביעת סמנים מחדש כשמצב הצבע משתנה
  useEffect(() => {
    markersRef.current.forEach((m) => { m.el.style.background = markerColor(db, m.key, colorMode); });
  }, [db, colorMode]);

  // מצב ציור תיחום
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!drawing) return;
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      drawPointsRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      setDrawCount(drawPointsRef.current.length);
      renderTerritory(map, drawPointsRef.current.length >= 3 ? drawPointsRef.current : undefined);
    };
    map.on('click', onClick);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [drawing]);

  const startDraw = () => {
    drawPointsRef.current = [];
    setDrawCount(0);
    setDrawing(true);
  };

  const saveDraw = async () => {
    const pts = drawPointsRef.current;
    if (pts.length < 3) { window.alert('צריך לפחות 3 נקודות לתיחום'); return; }
    const ring: [number, number][] = [...pts, pts[0]!]; // סגירת הטבעת — בישן זה היה מקור לבאגים
    await updateSettings({
      territory: { ...territory, polygon: ring, displayMode: territory.displayMode ?? 'border' },
    });
    setDrawing(false);
    if (mapRef.current) renderTerritory(mapRef.current, ring);
  };

  const cancelDraw = () => {
    setDrawing(false);
    drawPointsRef.current = [];
    if (mapRef.current) renderTerritory(mapRef.current, territory.polygon);
  };

  const clearTerritory = async () => {
    if (!window.confirm('להסיר את תיחום הטריטוריה?')) return;
    await updateSettings({ territory: { ...territory, polygon: undefined } });
    if (mapRef.current) renderTerritory(mapRef.current, undefined);
  };

  const toggleSatellite = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !satellite;
    map.setStyle(next ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/streets-v12');
    map.once('idle', () => renderTerritory(map, drawing ? drawPointsRef.current : territory.polygon));
    setSatellite(next);
  };

  if (failed) {
    return (
      <div className="map-fallback">
        <p>המפה לא נטענה בדפדפן הזה (WebGL). רשימת הבניינים זמינה בתצוגת הטבלה.</p>
      </div>
    );
  }

  return (
    <div className="map-shell">
      <div ref={container} className="map-canvas" />
      <div className="map-controls">
        <label className="filter-pill" style={{ boxShadow: 'var(--shadow-md)' }}>
          <i className="fas fa-fill-drip" /> צבע לפי
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
            <option value="style">סגנון</option>
            <option value="category">קטגוריה</option>
            <option value="territory">בתיחום / מחוץ</option>
          </select>
        </label>
        {!drawing ? (
          <>
            <button className="map-ctl-btn" onClick={startDraw} title="ציור תיחום טריטוריה">
              <i className="fas fa-draw-polygon" /> תיחום
            </button>
            {territory.polygon && (
              <button className="map-ctl-btn" onClick={() => void clearTerritory()} title="הסרת תיחום">
                <i className="fas fa-eraser" />
              </button>
            )}
          </>
        ) : (
          <>
            <span className="map-draw-hint">{drawCount} נקודות — לחץ על המפה להוספה</span>
            <button className="map-ctl-btn primary" onClick={() => void saveDraw()}>שמירת תיחום</button>
            <button className="map-ctl-btn" onClick={cancelDraw}>ביטול</button>
          </>
        )}
      </div>
      <button className="map-style-btn" onClick={toggleSatellite} title="לוויין / מפה">
        <i className={`fas ${satellite ? 'fa-map' : 'fa-satellite'}`} />
      </button>
      <div className="map-hint">{markersRef.current.length} בניינים · לחיצה על סמן פותחת את הבניין</div>
    </div>
  );
}
