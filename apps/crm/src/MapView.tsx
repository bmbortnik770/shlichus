import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  type Db,
  NO_ADDRESS_KEY,
  SEVERITY_COLORS,
  buildingKeys,
  categoryColor,
  getBuilding,
  getStatusColor,
  getTerritory,
  liveApts,
  pointInPolygon,
  statusSeverity,
} from '@shlichus/core';
import { useCrm } from './store';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';

// מצבי צבע כמו markerColorMode בישן (status ברירת מחדל) + התוספות שלנו
type ColorMode = 'status' | 'style' | 'tag' | 'category' | 'territory';

const CHART_STYLE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];
const MARKER_PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#14b8a6', '#f43f5e', '#84cc16', '#0ea5e9'];

/** getColorForString — העתק מדויק מהישן */
function colorForString(db: Db, str: string | undefined, type: 'style' | 'tag'): string {
  if (!str) return '#94a3b8';
  const s = db.__SETTINGS__ ?? {};
  if (type === 'style') {
    const custom = (s.styleColors ?? {}) as Record<string, string>;
    if (custom[str]) return custom[str];
    const idx = ((s.styles ?? []) as string[]).indexOf(str);
    return idx === -1 ? '#94a3b8' : CHART_STYLE_COLORS[idx % CHART_STYLE_COLORS.length]!;
  }
  const custom = (s.tagColors ?? {}) as Record<string, string>;
  if (custom[str]) return custom[str];
  const idx = ((s.tags ?? []) as string[]).indexOf(str);
  return idx === -1 ? '#94a3b8' : MARKER_PALETTE[idx % MARKER_PALETTE.length]!;
}

/** צבע סמן בניין — אותה לוגיקה כמו refreshMap בישן לכל מצב */
function bldgMarkerColor(db: Db, key: string, mode: ColorMode): string {
  const entry = getBuilding(db, key)!;
  const apts = liveApts(entry.apts);
  if (mode === 'style') return colorForString(db, apts[0]?.style, 'style');
  if (mode === 'tag') return colorForString(db, apts[0]?.tags?.[0], 'tag');
  if (mode === 'category') {
    return categoryColor(db, String(entry.info?.categoryId ?? entry.info?.category ?? '') || undefined);
  }
  if (mode === 'territory') {
    const poly = getTerritory(db).polygon;
    if (!poly || !entry.info?.coords) return '#94a3b8';
    return pointInPolygon(entry.info.coords as [number, number], poly) ? '#10b981' : '#94a3b8';
  }
  // status — הצבע החמור מבין הדירות (maxVal בישן)
  let maxVal = 0;
  apts.forEach((a) => {
    const v = statusSeverity(getStatusColor(a, db.__SETTINGS__));
    if (v > maxVal) maxVal = v;
  });
  return SEVERITY_COLORS[maxVal]!;
}

export function MapView({ db, onOpenBuilding, filterStyle = '', filterTag = '' }: { db: Db; onOpenBuilding: (key: string) => void; filterStyle?: string; filterTag?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [markerCount, setMarkerCount] = useState(0);
  const ensureBuilding = useCrm((s) => s.ensureBuilding);
  const dbRef = useRef(db);
  dbRef.current = db;

  const settings = db.__SETTINGS__ ?? {};
  const territory = getTerritory(db);
  const home = (settings.homeLocation ?? {}) as { coords?: [number, number]; address?: string; isChabad?: boolean };

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

  /** בניית כל הסמנים — שחזור מדויק של refreshMap */
  const buildMarkers = (map: mapboxgl.Map) => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    let count = 0;

    // סמן בית חב"ד — עיגול עם תמונת 770 וחץ, כמו בישן
    if (home.coords && home.isChabad) {
      const el = document.createElement('div');
      el.className = 'chabad-pin-wrapper';
      el.innerHTML = `<div class="chabad-pin-container"><div class="chabad-pin-circle"><div class="chabad-pin-image"></div></div><div class="chabad-pin-arrow"></div></div>`;
      el.addEventListener('click', () => {
        const ch = buildingKeys(db).find((k) => {
          const c = getBuilding(db, k)?.info?.coords;
          return c && Math.abs(c[0]! - home.coords![0]) < 0.001;
        });
        if (ch) onOpenBuilding(ch);
      });
      markersRef.current.push(
        new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(home.coords).addTo(map)
      );
    }

    for (const key of buildingKeys(db)) {
      if (key === NO_ADDRESS_KEY) continue;
      const entry = getBuilding(db, key)!;
      const apts = liveApts(entry.apts);
      if (apts.length === 0) continue; // רק בניינים עם משפחות — כמו בישן
      // הפילטרים הגלובליים מסננים גם את המפה — כמו filteredRes ב-refreshMap
      if (filterStyle || filterTag) {
        const show = apts.some((a) =>
          (!filterStyle || a.style === filterStyle) && (!filterTag || (a.tags ?? []).includes(filterTag)));
        if (!show) continue;
      }
      const coords = (entry.info?.coords ?? key.split(',').map(Number)) as [number, number];
      if (!Array.isArray(coords) || isNaN(coords[0]!) || isNaN(coords[1]!)) continue;

      // אלמנט זהה לישן: עיגול 28px, מספר משפחות, מסגרת לבנה וצל
      const el = document.createElement('div');
      el.className = 'bldg-marker';
      el.style.cssText =
        'width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer;';
      el.style.backgroundColor = bldgMarkerColor(db, key, colorMode);
      el.innerText = String(apts.length);
      el.title = key;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onOpenBuilding(key);
      });

      // אם זה בניין בית חב"ד — הזז כדי ששני הסמנים ייראו (כמו בישן)
      const isChabadBldg =
        home.isChabad && home.coords &&
        Math.abs(coords[0]! - home.coords[0]) < 0.0002 && Math.abs(coords[1]! - home.coords[1]) < 0.0002;
      markersRef.current.push(
        new mapboxgl.Marker({ element: el, offset: isChabadBldg ? [22, -10] : [0, 0] })
          .setLngLat(coords)
          .addTo(map)
      );
      count++;
    }
    setMarkerCount(count);
  };

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: mapboxgl.Map;
    try {
      // אתחול זהה לישן: center/zoom/pitch מההגדרות — pitch 60 = מבט תלת-ממדי
      map = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: (settings.center as [number, number]) ?? home.coords ?? [35.2443, 31.8265],
        zoom: (settings.zoom as number) ?? 17.5,
        pitch: (settings.pitch as number) ?? 60,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
        'bottom-right'
      );
      mapRef.current = map;
      (window as unknown as { __map?: mapboxgl.Map }).__map = map; // לבדיקות

      // ── שכבת בניינים תלת-ממדית + ריחוף + לחיצה — העתק מדויק מהישן ──
      const accent = String(dbRef.current.__SETTINGS__?.themeColor ?? '#3b82f6');
      let hoveredStateId: string | number | null = null;
      const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

      map.on('style.load', () => {
        if (!map.getLayer('3d-buildings')) {
          map.addLayer({
            id: '3d-buildings', source: 'composite', 'source-layer': 'building',
            filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 15,
            paint: {
              'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], accent, '#d1d5db'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.8,
            },
          });
        }
      });

      map.on('mousemove', '3d-buildings', (e) => {
        const features = (e as unknown as { features?: { id?: string | number }[] }).features;
        if (!features?.length) return;
        map.getCanvas().style.cursor = 'pointer';
        if (hoveredStateId !== null) map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoveredStateId }, { hover: false });
        hoveredStateId = features[0]!.id as string | number;
        map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoveredStateId }, { hover: true });
        hoverPopup.setLngLat(e.lngLat).setHTML(
          '<div style="direction:rtl;font-weight:600;font-size:12px;color:' + accent + ';">👆 ניהול בניין</div>'
        ).addTo(map);
      });
      map.on('mouseleave', '3d-buildings', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredStateId !== null) map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoveredStateId }, { hover: false });
        hoveredStateId = null;
        hoverPopup.remove();
      });

      map.on('click', '3d-buildings', (e) => {
        hoverPopup.remove();
        const clickPt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const cur = dbRef.current;

        // 1. נקודה בתוך פוליגון של כרטיס קיים → פתח אותו (כמו בישן)
        for (const key of buildingKeys(cur)) {
          const ring = getBuilding(cur, key)?.info?.polygon as [number, number][] | undefined;
          if (!ring || ring.length < 3) continue;
          if (pointInPolygon(clickPt, ring)) { onOpenBuilding(key); return; }
        }

        // 2. אחרת — reverse geocode, צור כרטיס עם coords+polygon, ופתח
        void (async () => {
          try {
            const r = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${e.lngLat.lng},${e.lngLat.lat}.json?types=address&language=he&access_token=${mapboxgl.accessToken}`
            );
            const d = (await r.json()) as { features?: { place_name: string; place_name_he?: string }[] };
            let addr = `מיקום (${e.lngLat.lng.toFixed(4)}, ${e.lngLat.lat.toFixed(4)})`;
            if (d.features?.length) addr = (d.features[0]!.place_name_he || d.features[0]!.place_name).split(',')[0]!.trim();

            const clicked = map.queryRenderedFeatures(e.point, { layers: ['3d-buildings'] });
            let polygon: unknown = null;
            const geom = (clicked[0] as unknown as { geometry?: { type?: string; coordinates?: unknown[][] } })?.geometry;
            if (geom?.type === 'Polygon') polygon = geom.coordinates![0];
            else if (geom?.type === 'MultiPolygon') polygon = (geom.coordinates![0] as unknown[][])[0];

            await ensureBuilding(addr, { coords: clickPt, polygon });
            onOpenBuilding(addr);
          } catch {
            window.alert('שגיאת כתובת');
          }
        })();
      });
      buildMarkers(map);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // בנייה מחדש של סמנים כשהנתונים או מצב הצבע משתנים
  useEffect(() => {
    if (mapRef.current) buildMarkers(mapRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, colorMode, filterStyle, filterTag]);

  const flyToHome = () => {
    // זהה ל-flyToHome בישן
    if (home.coords && mapRef.current) {
      mapRef.current.flyTo({ center: home.coords, zoom: 19, pitch: 60 });
    } else {
      window.alert('לא הוגדר מיקום מרכזי. הגדר בהגדרות.');
    }
  };

  const toggleSatellite = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !satellite;
    map.setStyle(next ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/streets-v12');
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
            <option value="status">סטטוס קשר</option>
            <option value="style">סגנון</option>
            <option value="tag">תגית</option>
            <option value="category">קטגוריה</option>
            <option value="territory">בתיחום / מחוץ</option>
          </select>
        </label>
      </div>
      {home.coords && (
        <button className="map-home-btn" onClick={flyToHome} title="חזרה לבית חב״ד" id="btnGoHome">
          {home.isChabad ? <span className="home-770" /> : <i className="fas fa-home" style={{ color: 'var(--accent)' }} />}
        </button>
      )}
      <button className="map-style-btn" onClick={toggleSatellite} title="לוויין / מפה">
        <i className={`fas ${satellite ? 'fa-map' : 'fa-satellite'}`} />
      </button>
      <div className="map-hint">{markerCount} בניינים מאוישים · לחיצה על סמן פותחת את הבניין</div>
    </div>
  );
}
