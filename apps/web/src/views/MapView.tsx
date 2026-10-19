import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { isDark } from '../themeMode';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../map/map.css';
import {
  type Db, type LngLat, addManualBuilding, addressMatchesOfficial, bboxOf, brokenKind, buildingAt, buildingKeys, geocodeAddress, getCategories,
  labelPoint, lastContact, linkManually, manualBuildings, matchBuildings, pendingFixes, pointInPolygon,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useToast } from '../ui';
import { missionCity, useMapData } from '../mapData';
import { useNav } from '../nav';
import { type BuildingView, type ColorMode, STYLE_COLORS, buildViews, findView, prepareBaseMap, orphansGeoJson, readPalette, territoryMask, toGeoJson } from '../map/features';
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
  { key: 'style', label: 'סגנון' },
  { key: 'tag', label: 'תגית' },
];
type Home = { coords?: LngLat; address?: string };
const CLICKABLE = ['b-fill', 'b-3d', 'b-fam', 'orphans'];

export function MapView({ db, switcher }: { db: Db; switcher?: ReactNode }) {
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
  const [legendOpen, setLegendOpen] = useState(false);
  const [tag, setTag] = useState('');
  const [sat, setSat] = useState(false);
  /** הוספת בניין ידני: מצב בחירת נקודה, ואחריו טופס */
  const [adding, setAdding] = useState(false);
  const [manualAt, setManualAt] = useState<LngLat | null>(null);
  const settings = db.__SETTINGS__ ?? {};
  const styles = (settings.styles ?? []) as string[];
  const tags = (settings.tags ?? []) as string[];
  const home = settings.homeLocation as Home | undefined;

  useEffect(() => { void load(db); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  // נקודות הכניסה הרשמיות ברקע (נשמרות במטמון) — מהן המפה מחלקת בניינים לכניסות
  const verify = useMapData((s) => s.verify);
  // גם כשכתובות משתנות (תיקון כתיב, כתובת חדשה) — הכתובת החדשה מקבלת נקודת כניסה
  const keysSig = useMemo(() => buildingKeys(db).join('|'), [db]);
  useEffect(() => { if (status === 'ready' && buildings.length) void verify(db); }, [status, buildings.length, keysSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const allB = useMemo(() => [...buildings, ...manualBuildings(db)], [buildings, db]);
  const matches = useMemo(() => matchBuildings(db, allB, geo), [db, allB, geo]);
  const views = useMemo(() => buildViews(db, allB, matches, geo), [db, allB, matches, geo]);
  // בלי שכבת מבנים אין מול מה לבדוק — לא מציגים "בעיות" שהן בעצם חוסר נתונים
  const fixes = useMemo(() => (buildings.length ? pendingFixes(db, matches, geo) : []), [db, matches, geo, buildings.length]);

  // ── יצירת המפה פעם אחת ──
  useEffect(() => {
    if (!box.current) return;
    const dark = isDark();
    const s = db.__SETTINGS__ ?? {};
    const center = ((s.homeLocation as { coords?: LngLat } | undefined)?.coords ?? s.center ?? [35.2137, 31.7683]) as LngLat;
    const map = new mapboxgl.Map({
      container: box.current,
      style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center, zoom: 16.4, attributionControl: false,
    });
    mapRef.current = map;
    (window as unknown as { __shlichusMap?: mapboxgl.Map }).__shlichusMap = map; // לבדיקות
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.on('load', () => {
      // הבניינים של Mapbox יורדים — מוצג רק מה שנשמר ונלחץ
      // הבניינים של Mapbox יורדים — מוצג רק מה שנשמר ונלחץ; שמות בעברית
      prepareBaseMap(map);
      // המסגרת מקבלת את גודלה הסופי רק אחרי שהמסך נפרס — מודדים שוב, אחרת חלק מהמפה לא מצויר
      requestAnimationFrame(() => map.resize());
      map.once('idle', () => { map.resize(); map.triggerRepaint(); });
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource('sat', { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 });
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } });
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
      if (adding) {
        if (f) { toast('כאן כבר יש בניין. לחץ על מקום ריק במפה.'); return; }
        setAdding(false);
        setManualAt([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (pickFor) {
        // יחידה של כניסה ("<מבנה>#<כתובת>") — משייכים למבנה עצמו
        const bid = String(f?.properties?.id ?? '').split('#')[0];
        const b = bid ? allB.find((x) => x.id === bid) : null;
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
  }, [ready, pickFor, adding, allB, panel, mutate, toast]);

  // ── עדכון הנתונים והצבעים ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pal = readPalette();
    const { shapes, labels } = toGeoJson(db, views, mode, pal, { styles, tag });
    (map.getSource('shapes') as mapboxgl.GeoJSONSource).setData(shapes);
    (map.getSource('labels') as mapboxgl.GeoJSONSource).setData(labels);
    (map.getSource('orphans') as mapboxgl.GeoJSONSource).setData(orphansGeoJson(db, matches));
    (map.getSource('terr') as mapboxgl.GeoJSONSource).setData(territoryMask(db));
    // תצוגת התיחום מההגדרות: קו גבול (עם הכהיה עדינה), הכהיית החוץ, או בלי
    const disp = String((db.__SETTINGS__?.territory as { displayMode?: string } | undefined)?.displayMode ?? 'border');
    const dark = isDark();
    map.setLayoutProperty('terr-line', 'visibility', disp === 'none' ? 'none' : 'visible');
    map.setLayoutProperty('terr-mask', 'visibility', disp === 'none' ? 'none' : 'visible');
    map.setPaintProperty('terr-mask', 'fill-opacity', disp === 'fill' ? (dark ? 0.55 : 0.22) : (dark ? 0.35 : 0.07));
  }, [ready, db, views, matches, mode, tag]); // eslint-disable-line react-hooks/exhaustive-deps

  // לוויין: תמונת אוויר מתחת לבניינים, הבניינים שקופים יותר
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none');
    map.setPaintProperty('b-fill', 'fill-opacity', ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, ['==', ['get', 'inT'], 1], sat ? 0.6 : 0.9, sat ? 0.25 : 0.55]);
  }, [ready, sat]);

  // סימון בית חב"ד במפה
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !home?.coords) return;
    const el = document.createElement('button');
    el.className = 'home-mark';
    el.setAttribute('aria-label', 'בית חב"ד');
    const logo = settings.logo as string | undefined;
    if (logo) { const img = document.createElement('img'); img.src = logo; img.alt = ''; el.appendChild(img); } else el.textContent = 'חב״ד';
    el.addEventListener('click', (e) => { e.stopPropagation(); map.easeTo({ center: home.coords!, zoom: 17.8, duration: 700 }); });
    const marker = new mapboxgl.Marker({ element: el }).setLngLat(home.coords).addTo(map);
    return () => { marker.remove(); };
  }, [ready, home?.coords?.[0], home?.coords?.[1], settings.logo]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ?? findView(views, { id: buildingAt(pt, allB, 15)?.id });

  // ── חיפוש כתובת: קודם במבנים המוכרים, אחר כך בנקודת הכתובת הרשמית ──
  const search = async () => {
    const text = q.trim();
    if (!text) return;
    const known = matches.find((m) => m.key === text || m.key.replace(/\s+/g, ' ') === text);
    if (known?.official) { focus({ key: known.key }); setPanel('card'); return; }
    const off = allB.find((b) => addressMatchesOfficial(text, b));
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

  // ── לוח התוצאות של השליחות: כמה מהשכונה מכירים, ומה הקשר החודש לעומת החודש הקודם ──
  const progress = useMemo(() => {
    const now = Date.now();
    let contacted = 0, prev = 0, empty = 0;
    for (const v of views.values()) {
      if (!v.inTerritory) continue;
      if ((v.category ?? 'residential') === 'residential' && !v.families.length && (v.apts ?? 1) > 0) empty++;
      for (const f of v.families) {
        const d = lastContact(f.apt);
        if (!d) continue;
        const days = (now - d.getTime()) / 86400000;
        if (days <= 30) contacted++;
        else if (days <= 60) prev++;
      }
    }
    return { contacted, prev, empty };
  }, [views]);
  const pct = aptsInT ? Math.min(100, Math.round((familiesInT / aptsInT) * 100)) : 0;

  // בניין שנבחר ממסך אחר ("הצג במפה")
  const { focusKey } = useNav();
  useEffect(() => {
    if (!focusKey || !ready || !views.size) return;
    focus({ key: focusKey });
    setPanel('card');
    useNav.setState({ focusKey: null });
  }, [focusKey, ready, views]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mapv">
      <div className="map-box" ref={box} />

      <div className="map-top">
        {switcher}
        <form className="map-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="כתובת או בניין" aria-label="חיפוש כתובת במפה" />
        </form>
        <div className="seg" role="group" aria-label="צביעת בניינים">
          {MODES.filter((m) => (m.key === 'style' ? styles.length : m.key === 'tag' ? tags.length : true)).map((m) => (
            <button key={m.key} aria-pressed={mode === m.key} onClick={() => { setMode(m.key); if (m.key === 'tag' && !tag) setTag(tags[0] ?? ''); }}>{m.label}</button>
          ))}
        </div>
        {mode === 'tag' && (
          <select className="sel map-sel" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="איזו תגית">{tags.map((t) => <option key={t}>{t}</option>)}</select>
        )}
        <button className="btn map-btn legend-toggle" aria-pressed={legendOpen} onClick={() => setLegendOpen(!legendOpen)}>מקרא</button>
        <button className="btn map-btn" aria-pressed={is3d} onClick={() => setIs3d(!is3d)}>{is3d ? 'דו-ממד' : 'תלת-ממד'}</button>
        <button className="btn map-btn" aria-pressed={sat} onClick={() => setSat(!sat)}>לוויין</button>
        {home?.coords && <button className="btn map-btn" onClick={() => mapRef.current?.easeTo({ center: home.coords!, zoom: 17.2, duration: 700 })} title="חזרה לבית חב״ד"><Icon name="home" size={16} />הביתה</button>}
        <button className="btn map-btn" aria-pressed={adding} onClick={() => { setAdding(!adding); setPickFor(null); }} title="בניין שאין ברישום"><Icon name="plus" size={16} />בניין ידני</button>
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

      {adding && (
        <div className="pick-banner" role="status">
          לחץ במפה על המקום שבו עומד הבניין
          <button className="btn" onClick={() => setAdding(false)}>ביטול</button>
        </div>
      )}

      {hoverText && !pickFor && !adding && <div className="hover-chip">{hoverText}</div>}

      <Legend db={db} mode={mode} open={legendOpen} views={views} tag={tag} />

      <div className="map-progress" aria-label="התקדמות השליחות">
        <div className="prog">
          <div className="prog-top"><b>{familiesInT}</b>משפחות מוכרות{aptsInT ? <> מתוך <b>{aptsInT.toLocaleString('he-IL')}</b> דירות</> : null}</div>
          {aptsInT > 0 && <div className="prog-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(pct, 1)}%` }} /></div>}
          <small>{aptsInT ? `${pct}% מהדירות בתיחום` : 'מספר הדירות בתיחום לא ידוע'}</small>
        </div>
        <div className="prog-mini"><button onClick={() => setMode('status')} title="צביעה לפי קשר"><b>{progress.contacted}</b> בקשר החודש</button>
          <small>{progress.contacted === progress.prev ? 'כמו בחודש הקודם' : <>בחודש הקודם {progress.prev} <span className={progress.contacted > progress.prev ? 'up' : 'down'}>{progress.contacted > progress.prev ? '▲' : '▼'}</span></>}</small>
        </div>
        <div className="prog-mini"><button onClick={() => setMode('coverage')} title="צביעה לפי כיסוי"><b>{progress.empty}</b> בניינים בלי משפחה מוכרת</button></div>
      </div>
      {source && <div className="map-src" title={source.level === 'municipal' ? 'כתובות, דירות וקומות רשמיים' : 'צורות מבנים; כתובות מאומתות מול GovMap'}>מקור: {source.name}</div>}

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
      {manualAt && (
        <ManualBuildingDialog db={db} onClose={() => setManualAt(null)} onSave={(f) => {
          const at = manualAt;
          let id = '';
          const undo = mutate((d) => { id = addManualBuilding(d, f.address, at, { apts: f.apts || undefined, floors: f.floors || undefined, category: f.category }).id; });
          setManualAt(null);
          toast(`הבניין "${f.address}" נוסף למפה`, undo);
          setSel({ id });
          setPanel('card');
        }} />
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

function Legend({ db, mode, open, views, tag }: { db: Db; mode: ColorMode; open: boolean; views: Map<string, BuildingView>; tag: string }) {
  const pal = readPalette();
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];
  const cats = getCategories(db);
  const items: [string, string][] =
    mode === 'status' ? [[pal.sev[1], 'בקשר'], [pal.sev[2], 'מתרחקים'], [pal.sev[3], 'צריך תשומת לב'], [pal.sev[0], 'לא היה קשר'], [pal.empty, 'בלי משפחות מוכרות']]
    : mode === 'category' ? []
    : mode === 'style' ? [...styles.map((st, i) => [STYLE_COLORS[i % STYLE_COLORS.length]!, st] as [string, string]), [pal.empty, 'בלי סגנון']]
    : mode === 'tag' ? [[pal.accent, `יש משפחה עם "${tag}"`], [pal.sev[0], 'משפחות בלי התגית'], [pal.empty, 'בלי משפחות מוכרות']]
    : [[pal.coverage[1], 'רוב הדירות מוכרות'], [mix2(pal), 'חלק מהדירות'], [pal.empty, 'אף דירה לא מוכרת']];
  // דיאגרמת סוגי הבניינים בתיחום
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    let total = 0;
    for (const v of views.values()) {
      if (!v.inTerritory) continue;
      total++;
      const c = v.category ?? 'none';
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return { m, total };
  }, [views]);
  return (
    <div className={`legend${open ? ' open' : ''}`} aria-label="מקרא">
      {mode === 'category' ? (
        <div className="cat-chart" aria-label="סוגי הבניינים בתיחום">
          <div className="cat-bar">
            {cats.filter((c) => counts.m.get(c.id)).map((c) => <i key={c.id} style={{ background: c.color, flexGrow: counts.m.get(c.id) }} title={`${c.name}: ${counts.m.get(c.id)}`} />)}
            {counts.m.get('none') ? <i style={{ background: pal.empty, flexGrow: counts.m.get('none') }} title="לא סווג" /> : null}
          </div>
          {cats.map((c) => <span key={c.id}><i style={{ background: c.color }} />{c.name} <b className="num">{counts.m.get(c.id) ?? 0}</b></span>)}
          {counts.m.get('none') ? <span><i style={{ background: pal.empty }} />לא סווג <b className="num">{counts.m.get('none')}</b></span> : null}
        </div>
      ) : items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
      <span><i className="terr" />גבול התיחום</span>
    </div>
  );
}

function ManualBuildingDialog({ db, onClose, onSave }: { db: Db; onClose: () => void; onSave: (f: { address: string; apts: number; floors: number; category: string }) => void }) {
  const [address, setAddress] = useState('');
  const [apts, setApts] = useState('');
  const [floors, setFloors] = useState('');
  const [category, setCategory] = useState('residential');
  const a = address.trim();
  const kind = a ? brokenKind(a) : null;
  const exists = a && buildingKeys(db).includes(a);
  return (
    <Dialog title="בניין ידני" onClose={onClose}>
      <p className="dialog-note">לבניין שאין ברישום הרשמי (למשל בניין חדש). הוא יופיע במפה במקום שלחצת.</p>
      <label className="fld"><span>כתובת (רחוב ומספר בית)</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="למשל: הרב ניסים 5" /></label>
      <label className="fld"><span>דירות</span><input value={apts} onChange={(e) => setApts(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
      <label className="fld"><span>קומות</span><input value={floors} onChange={(e) => setFloors(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
      <label className="fld"><span>סוג</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{getCategories(db).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {kind === 'nonum' && <p className="dialog-note addr-missing">צריך מספר בית.</p>}
      {exists && <p className="dialog-note">הכתובת קיימת אצלך — המשפחות שלה יעברו לבניין הזה.</p>}
      <div className="dialog-acts">
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn btn-primary" disabled={!a || !!kind} onClick={() => onSave({ address: a, apts: Number(apts) || 0, floors: Number(floors) || 0, category })}>הוספה</button>
      </div>
    </Dialog>
  );
}
const mix2 = (pal: ReturnType<typeof readPalette>) => pal.coverage[0];
