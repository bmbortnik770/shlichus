import { useEffect, useMemo, useRef, useState } from 'react';
import { isDark } from '../themeMode';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type Db, type LngLat, bboxOf, getTerritory, polygonAreaM2, polygonInTerritory } from '@shlichus/core';
import { useStore } from '../store';
import { useToast } from '../ui';
import { useMapData } from '../mapData';
import { prepareBaseMap, readPalette } from '../map/features';

/**
 * עורך תיחום: לחיצה על המפה מוסיפה נקודה, גרירת נקודה מזיזה אותה, לחיצה על נקודה מוחקת אותה.
 * תוך כדי מוצג כמה בניינים ודירות בתוך התיחום — לפי צורת הבניין המלאה, כמו במפה.
 */
export function TerritoryEditor({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const { buildings, load, status, error } = useMapData();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const saved = (getTerritory(db).polygon ?? []) as LngLat[];
  const [pts, setPts] = useState<LngLat[]>(saved);
  const [ready, setReady] = useState(false);
  const dirty = JSON.stringify(pts) !== JSON.stringify(saved);

  useEffect(() => { void load(db); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!box.current) return;
    const dark = isDark();
    const s = db.__SETTINGS__ ?? {};
    const center = ((s.homeLocation as { coords?: LngLat } | undefined)?.coords ?? [35.2137, 31.7683]) as LngLat;
    const map = new mapboxgl.Map({ container: box.current, style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11', center, zoom: 15.5, attributionControl: false });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('load', () => {
      prepareBaseMap(map);
      // המסגרת מקבלת את גודלה הסופי רק אחרי שהמסך נפרס — מודדים שוב, אחרת חלק מהמפה לא מצויר
      requestAnimationFrame(() => map.resize());
      map.once('idle', () => { map.resize(); map.triggerRepaint(); });
      const pal = readPalette();
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource('tb', { type: 'geojson', data: empty });
      map.addSource('tp', { type: 'geojson', data: empty });
      map.addLayer({ id: 'tb', type: 'fill', source: 'tb', paint: { 'fill-color': ['case', ['==', ['get', 'in'], 1], pal.accent, pal.empty], 'fill-opacity': ['case', ['==', ['get', 'in'], 1], 0.55, 0.7] } });
      map.addLayer({ id: 'tp-fill', type: 'fill', source: 'tp', paint: { 'fill-color': pal.accent, 'fill-opacity': 0.06 } });
      map.addLayer({ id: 'tp-line', type: 'line', source: 'tp', paint: { 'line-color': pal.accent, 'line-width': 2.5 } });
      if (saved.length >= 3) { const [w, so, e, n] = bboxOf(saved, 60); map.fitBounds([[w, so], [e, n]], { duration: 0 }); }
      setReady(true);
    });
    map.on('click', (e) => setPts((p) => [...p, [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))]]));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => { ro.disconnect(); map.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // נקודות גרירות
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = pts.map((p, i) => {
      const el = document.createElement('button');
      el.className = 'tv-dot';
      el.setAttribute('aria-label', `נקודה ${i + 1}: גרירה להזזה, לחיצה למחיקה`);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); setPts((x) => x.filter((_, j) => j !== i)); });
      const mk = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      mk.on('dragend', () => { const ll = mk.getLngLat(); setPts((x) => x.map((q, j) => (j === i ? [Number(ll.lng.toFixed(7)), Number(ll.lat.toFixed(7))] as LngLat : q))); });
      return mk;
    });
    const ring = pts.length >= 3 ? [[...pts, pts[0]!]] : null;
    (map.getSource('tp') as mapboxgl.GeoJSONSource).setData(ring ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: ring } } : { type: 'FeatureCollection', features: [] });
  }, [pts, ready]);

  const stats = useMemo(() => {
    let n = 0, apts = 0;
    const feats: GeoJSON.Feature[] = buildings.map((b) => {
      const inside = pts.length >= 3 && polygonInTerritory(b.polygon, pts);
      if (inside) { n++; apts += b.apts ?? 0; }
      return { type: 'Feature', properties: { in: inside ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [[...b.polygon, b.polygon[0]!]] } };
    });
    return { n, apts, feats };
  }, [buildings, pts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('tb') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: stats.feats });
  }, [stats, ready]);

  const area = pts.length >= 3 ? polygonAreaM2(pts) : 0;
  const save = () => {
    const undo = mutate((d) => {
      const s = d.__SETTINGS__ ?? {};
      d.__SETTINGS__ = { ...s, territory: { ...((s.territory ?? {}) as object), polygon: pts.length >= 3 ? pts : undefined }, updatedAt: Date.now() };
    });
    toast(pts.length >= 3 ? 'התיחום נשמר' : 'התיחום הוסר', undo);
  };

  return (
    <div className="tv">
      <div className="tv-map" ref={box} />
      <div className="tv-side">
        <div className="tv-stats">
          <div><b className="num">{stats.n}</b><span>בניינים</span></div>
          <div><b className="num">{stats.apts || '—'}</b><span>דירות</span></div>
          <div><b className="num">{area ? (area >= 1e6 ? `${(area / 1e6).toFixed(2)} קמ״ר` : `${Math.round(area / 1000)} דונם`) : '—'}</b><span>שטח</span></div>
        </div>
        {status === 'loading' && <p className="dialog-note">טוען את בנייני האזור…</p>}
        {status === 'error' && <p className="dialog-note addr-missing">{error} <button className="link" onClick={() => void load(db, true)}>לנסות שוב</button></p>}
        <p className="sheet-hint">לחיצה על המפה מוסיפה נקודה בסוף הקו. אפשר לגרור נקודה כדי להזיז אותה, וללחוץ עליה כדי למחוק. בניין נחשב בתוך התיחום לפי הצורה המלאה שלו.</p>
        <div className="fix-acts">
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>שמירת התיחום</button>
          <button className="btn" disabled={!pts.length} onClick={() => setPts((p) => p.slice(0, -1))}>ביטול נקודה אחרונה</button>
          <button className="btn" disabled={!dirty} onClick={() => setPts(saved)}>חזרה לשמור</button>
          <button className="btn btn-ghost-danger" disabled={!pts.length} onClick={() => setPts([])}>ניקוי</button>
        </div>
      </div>
    </div>
  );
}
