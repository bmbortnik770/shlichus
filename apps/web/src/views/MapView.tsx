import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../map/map.css';
import {
  type Db, type LngLat, addressMatchesOfficial, bboxOf, buildingAt, buildingKeys, geocodeAddress, getCategories,
  labelPoint, linkManually, matchBuildings, pendingFixes, pointInPolygon,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useToast } from '../ui';
import { missionCity, useMapData } from '../mapData';
import { type ColorMode, buildViews, findView, orphansGeoJson, readPalette, territoryMask, toGeoJson } from '../map/features';
import { BuildingCard } from './BuildingCard';
import { MapFixPanel } from './MapFix';

// עברית מימין לשמאל בתוויות המפה
if (mapboxgl.getRTLTextPluginStatus() === 'unavailable') {
  mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js', () => {}, true);
}

mapboxgl.accessToken = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';

const MODES: { key: ColorMode; label: string }[] = [
  { key: 'status', label: 'קשר עם המשפחות' },
  { key: 'category', label: 'סוג בניין' },
  { key: 'coverage', label: 'כיסוי דירות' },
];
const CLICKABLE = ['b-fill', 'b-3d', 'b-fam', 'orphans'];

export function MapView({ db }: { db: Db }) {
  const { buildings, status, error, source, geo, load } = useMapData();
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ColorMode>('status');
  const [is3d, setIs3d] = useState(false);
  const [sel, setSel] = useState<{ id?: string; key?: string } | null>(null);
  const [panel, setPanel] = useState<'card' | 'fix' | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [hover, setHover] = useState<string>('');
  const [q, setQ] = useState('');

  useEffect(() => { void load(db); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  // נקודות הכניסה הרשמיות ברקע (נשמרות במטמון) — מהן המפה מחלקת בניינים לכניסות
  const verify = useMapData((s) => s.verify);
  // גם כשכתובות משתנות (תיקון כתיב, כתובת חדשה) — הכתובת החדשה מקבלת נקודת כניסה
  const keysSig = useMemo(() => buildingKeys(db).join('|'), [db]);
  useEffect(() => { if (status === 'ready' && buildings.length) void verify(db); }, [status, buildings.length, keysSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => matchBuildings(db, buildings, geo), [db, buildings, geo]);
  const views = useMemo(() => buildViews(db, buildings, matches, geo), [db, buildings, matches, geo]);
  // בלי שכבת מבנים אין מול מה לבדוק — לא מציגים "בעיות" שהן בעצם חוסר נתונים
  const fixes = useMemo(() => (buildings.length ? pendingFixes(db, matches, geo) : []), [db, matches, geo, buildings.length]);

  // ── יצירת המפה פעם אחת ──
  useEffect(() => {
    if (!box.current) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const s = db.__SETTINGS__ ?? {};
    const center = ((s.homeLocation as { coords?: LngLat } | undefined)?.coords ?? s.center ?? [35.2137, 31.7683]) as LngLat;
    const map = new mapboxgl.Map({
      container: box.current,
      style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center, zoom: 16.4, attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.on('load', () => {
      // הבניינים של Mapbox יורדים — מוצג רק מה שנשמר ונלחץ
      for (const l of map.getStyle().layers ?? []) {
        if ((l as { 'source-layer'?: string })['source-layer'] === 'building') map.setLayoutProperty(l.id, 'visibility', 'none');
        // שמות רחובות ומקומות בשם המקומי (עברית) במקום אנגלית
        if (l.type === 'symbol') {
          const tf = map.getLayoutProperty(l.id, 'text-field');
          if (tf && JSON.stringify(tf).includes('name_en')) map.setLayoutProperty(l.id, 'text-field', JSON.parse(JSON.stringify(tf).replace(/"name_en"/g, '"name"')));
        }
      }
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource('terr', { type: 'geojson', data: empty });
      map.addSource('shapes', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addSource('labels', { type: 'geojson', data: empty });
      map.addSource('orphans', { type: 'geojson', data: empty });
      const pal = readPalette();
      map.addLayer({ id: 'terr-mask', type: 'fill', source: 'terr', filter: ['==', ['get', 'kind'], 'mask'], paint: { 'fill-color': dark ? '#000' : '#1b2b28', 'fill-opacity': dark ? 0.35 : 0.07 } });
      map.addLayer({ id: 'b-fill', type: 'fill', source: 'shapes', paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, ['==', ['get', 'inT'], 1], 0.9, 0.55],
      } });
      map.addLayer({ id: 'b-3d', type: 'fill-extrusion', source: 'shapes', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.92,
      } });
      map.addLayer({ id: 'b-line', type: 'line', source: 'shapes', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], pal.selected, pal.line],
        'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3, 0.6],
      } });
      map.addLayer({ id: 'terr-line', type: 'line', source: 'terr', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': pal.accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'b-num', type: 'symbol', source: 'labels', minzoom: 16.8, filter: ['all', ['!=', ['get', 'num'], ''], ['==', ['get', 'fam'], 0]], layout: {
        'text-field': ['get', 'num'], 'text-size': 11, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-allow-overlap': false,
      }, paint: { 'text-color': pal.text, 'text-halo-color': pal.halo, 'text-halo-width': 1.4, 'text-opacity': 0.75 } });
      map.addLayer({ id: 'b-fam', type: 'circle', source: 'labels', filter: ['>', ['get', 'fam'], 0], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 7, 18, 11], 'circle-color': pal.surface,
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5,
      } });
      map.addLayer({ id: 'b-fam-n', type: 'symbol', source: 'labels', filter: ['>', ['get', 'fam'], 0], layout: {
        'text-field': ['to-string', ['get', 'fam']], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true,
      }, paint: { 'text-color': pal.text } });
      map.addLayer({ id: 'orphans', type: 'circle', source: 'orphans', paint: {
        'circle-radius': 8, 'circle-color': pal.surface, 'circle-stroke-color': pal.sev[3], 'circle-stroke-width': 3,
      } });
      setReady(true);
    });

    let hovered: string | null = null;
    map.on('mousemove', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: CLICKABLE.filter((l) => map.getLayer(l)) })[0];
      const id = (f?.properties?.id as string | undefined) ?? null;
      if (hovered && hovered !== id) map.setFeatureState({ source: 'shapes', id: hovered }, { hover: false });
      if (id) map.setFeatureState({ source: 'shapes', id }, { hover: true });
      hovered = id;
      map.getCanvas().style.cursor = f ? 'pointer' : '';
      setHover(f ? String(f.properties?.id ?? f.properties?.key ?? '') : '');
    });
    // המפה עוקבת אחרי גודל המסגרת (סיבוב מסך, פתיחת לוח וכו')
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; setReady(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── לחיצה: תמיד לפי המבנה שנלחץ, אף פעם לא לפי חיפוש כתובת ליד הנקודה ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: CLICKABLE.filter((l) => map.getLayer(l)) })[0];
      if (pickFor) {
        // יחידה של כניסה ("<מבנה>#<כתובת>") — משייכים למבנה עצמו
        const bid = String(f?.properties?.id ?? '').split('#')[0];
        const b = bid ? buildings.find((x) => x.id === bid) : null;
        if (!b) { toast('יש ללחוץ על בניין'); return; }
        const key = pickFor;
        const undo = mutate((d) => linkManually(d, key, b));
        setPickFor(null);
        setSel({ id: b.id });
        setPanel('fix');
        toast(`"${key}" שויך לבניין שבחרת`, undo);
        return;
      }
      if (!f) { setSel(null); if (panel === 'card') setPanel(null); return; }
      if (f.properties?.key) setSel({ key: String(f.properties.key) });
      else setSel({ id: String(f.properties?.id) });
      setPanel('card');
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [ready, pickFor, buildings, panel, mutate, toast]);

  // ── עדכון הנתונים והצבעים ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pal = readPalette();
    const { shapes, labels } = toGeoJson(db, views, mode, pal);
    (map.getSource('shapes') as mapboxgl.GeoJSONSource).setData(shapes);
    (map.getSource('labels') as mapboxgl.GeoJSONSource).setData(labels);
    (map.getSource('orphans') as mapboxgl.GeoJSONSource).setData(orphansGeoJson(db, matches));
    (map.getSource('terr') as mapboxgl.GeoJSONSource).setData(territoryMask(db));
  }, [ready, db, views, matches, mode]);

  // סימון הנבחר
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.removeFeatureState({ source: 'shapes' });
    if (sel?.id) map.setFeatureState({ source: 'shapes', id: sel.id }, { sel: true });
  }, [ready, sel, views]);

  // דו-ממד / תלת-ממד
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty('b-3d', 'visibility', is3d ? 'visible' : 'none');
    map.setLayoutProperty('b-fill', 'visibility', is3d ? 'none' : 'visible');
    map.easeTo({ pitch: is3d ? 55 : 0, duration: 600 });
  }, [ready, is3d]);

  // מעבר לאזור העבודה כשהמבנים נטענו
  const framed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || framed.current || !buildings.length) return;
    framed.current = true;
    const pts = [...views.values()].filter((v) => v.families.length || v.inTerritory).flatMap((v) => v.b.polygon);
    if (pts.length) {
      const [w, s, e, n] = bboxOf(pts);
      map.fitBounds([[w, s], [e, n]], { padding: 48, duration: 0, maxZoom: 17.5 });
    }
  }, [ready, buildings, views]);

  const flyTo = (pt: LngLat) => mapRef.current?.easeTo({ center: pt, zoom: Math.max(mapRef.current.getZoom(), 17.6), duration: 700 });
  const focus = (target: { id?: string; key?: string }) => {
    const v = findView(views, target);
    if (v) { setSel({ id: v.id }); flyTo(labelPoint(v.polygon)); return; }
    setSel(target);
    const c = target.key ? (db[target.key] as { info?: { coords?: LngLat } } | undefined)?.info?.coords : undefined;
    if (c) flyTo(c);
  };
  /** היחידה (בניין או כניסה) שהנקודה בתוכה */
  const viewAt = (pt: LngLat) => [...views.values()].find((v) => pointInPolygon(pt, v.polygon))
    ?? findView(views, { id: buildingAt(pt, buildings, 15)?.id });

  // ── חיפוש כתובת: קודם במבנים המוכרים, אחר כך בנקודת הכתובת הרשמית ──
  const search = async () => {
    const text = q.trim();
    if (!text) return;
    const known = matches.find((m) => m.key === text || m.key.replace(/\s+/g, ' ') === text);
    if (known?.official) { focus({ key: known.key }); setPanel('card'); return; }
    const off = buildings.find((b) => addressMatchesOfficial(text, b));
    if (off) { focus({ id: off.id }); setPanel('card'); return; }
    const hit = await geocodeAddress(text, missionCity(db)).catch(() => null);
    if (!hit) { toast('הכתובת לא נמצאה ברישום הרשמי. כדאי לבדוק את מספר הבית.'); return; }
    const v = viewAt(hit.point);
    if (v) { focus({ id: v.id }); setPanel('card'); }
    else { flyTo(hit.point); toast('הכתובת נמצאה, אבל אין במקום מבנה ידוע'); }
  };

  const selView = sel?.id ? views.get(sel.id) ?? null : null;
  const hoverText = hover ? (views.get(hover) ? labelOf(views.get(hover)!) : hover) : '';
  const familiesInT = [...views.values()].reduce((s, v) => s + (v.inTerritory ? v.families.length : 0), 0);
  const aptsInT = [...views.values()].reduce((s, v) => s + (v.inTerritory && (v.category ?? 'residential') === 'residential' ? v.apts ?? 0 : 0), 0);
  const needUser = fixes.filter((f) => f.needsUser).length;

  return (
    <div className="mapv">
      <div className="map-box" ref={box} />

      <div className="map-top">
        <form className="map-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="כתובת או בניין" aria-label="חיפוש כתובת במפה" />
        </form>
        <div className="seg" role="group" aria-label="צביעת בניינים">
          {MODES.map((m) => (
            <button key={m.key} aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <button className="btn map-btn" aria-pressed={is3d} onClick={() => setIs3d(!is3d)}>{is3d ? 'דו-ממד' : 'תלת-ממד'}</button>
        <button className={`btn map-btn${fixes.length ? ' has-fix' : ''}`} onClick={() => setPanel(panel === 'fix' ? null : 'fix')}>
          <Icon name="tasks" size={16} />דיוק המפה
          {fixes.length > 0 && <span className="fix-count">{fixes.length}</span>}
        </button>
      </div>

      {pickFor && (
        <div className="pick-banner" role="status">
          לחץ על הבניין הנכון עבור <b>{pickFor}</b>
          <button className="btn" onClick={() => setPickFor(null)}>ביטול</button>
        </div>
      )}

      {hoverText && !pickFor && <div className="hover-chip">{hoverText}</div>}

      <Legend db={db} mode={mode} />

      <div className="map-stats">
        <div><b className="num">{familiesInT}</b><span>משפחות בתיחום</span></div>
        <div><b className="num">{aptsInT || '—'}</b><span>דירות מגורים</span></div>
        <div><b className="num">{aptsInT ? `${Math.round((familiesInT / aptsInT) * 100)}%` : '—'}</b><span>כיסוי</span></div>
        {source && <div className="src" title={source.level === 'municipal' ? 'כתובות, דירות וקומות רשמיים' : 'צורות מבנים; כתובות מאומתות מול GovMap'}>מקור: {source.name}</div>}
      </div>

      {status === 'loading' && <div className="map-state">טוען את מבני האזור…</div>}
      {status === 'error' && (
        <div className="map-state err">
          {error}
          <button className="btn" onClick={() => void load(db, true)}>לנסות שוב</button>
        </div>
      )}

      {panel === 'card' && (selView || sel?.key) && (
        <BuildingCard db={db} view={selView} orphanKey={sel?.key} onClose={() => { setPanel(null); setSel(null); }}
          onPick={(key) => { setPickFor(key); setPanel(null); }} onSelectKey={(key) => focus({ key })} />
      )}
      {panel === 'fix' && (
        <MapFixPanel db={db} noData={!buildings.length} fixes={fixes} waiting={matches.filter((m) => m.waitingForNumber).map((m) => ({ key: m.key, families: m.families }))} needUser={needUser} total={matches.length} onClose={() => setPanel(null)}
          onFocus={focus} onPick={(key) => { setPickFor(key); setPanel(null); }} />
      )}
    </div>
  );
}

function labelOf(v: { keys: string[]; b: { street: string; num: number | null } }): string {
  if (v.keys.length) return v.keys.length > 1 ? `${v.keys[0]} (+${v.keys.length - 1})` : v.keys[0]!;
  return v.b.num ? `${v.b.street} ${v.b.num}` : v.b.street || 'בניין';
}

function Legend({ db, mode }: { db: Db; mode: ColorMode }) {
  const pal = readPalette();
  const items: [string, string][] =
    mode === 'status' ? [[pal.sev[1], 'בקשר'], [pal.sev[2], 'מתרחקים'], [pal.sev[3], 'צריך תשומת לב'], [pal.sev[0], 'לא היה קשר'], [pal.empty, 'בלי משפחות מוכרות']]
    : mode === 'category' ? getCategories(db).map((c) => [c.color, c.name] as [string, string])
    : [[pal.coverage[1], 'רוב הדירות מוכרות'], [mix2(pal), 'חלק מהדירות'], [pal.empty, 'אף דירה לא מוכרת']];
  return (
    <div className="legend" aria-label="מקרא">
      {items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
      <span><i className="terr" />גבול התיחום</span>
    </div>
  );
}
const mix2 = (pal: ReturnType<typeof readPalette>) => pal.coverage[0];
