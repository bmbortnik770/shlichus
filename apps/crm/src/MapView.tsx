import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';

interface Marker {
  key: string;
  coords: [number, number];
  families: number;
}

function collectMarkers(db: Db): Marker[] {
  const out: Marker[] = [];
  for (const key of buildingKeys(db)) {
    const entry = getBuilding(db, key);
    const c = entry?.info?.coords;
    if (!c || !Array.isArray(c) || c.length !== 2 || isNaN(c[0]!) || isNaN(c[1]!)) continue;
    out.push({ key, coords: c as [number, number], families: liveApts(entry!.apts).length });
  }
  return out;
}

export function MapView({ db, onOpenBuilding }: { db: Db; onOpenBuilding: (key: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const markers = collectMarkers(db);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: mapboxgl.Map;
    try {
      const center = markers[0]?.coords ?? [34.989, 32.794]; // ברירת מחדל אם אין נתונים
      map = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center,
        zoom: 14,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl(), 'top-left');
      mapRef.current = map;

      for (const m of markers) {
        const el = document.createElement('button');
        el.className = 'map-marker';
        el.textContent = String(m.families || '');
        el.title = m.key;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onOpenBuilding(m.key);
        });
        new mapboxgl.Marker({ element: el }).setLngLat(m.coords).addTo(map);
      }

      if (markers.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        markers.forEach((m) => bounds.extend(m.coords));
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
      }
    } catch (e) {
      console.error('map init failed', e);
      setFailed(true);
      return;
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // markers נבנים מ-db; אתחול חד-פעמי בכוונה — עדכוני markers חיים בשלב הבא
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="map-hint">{markers.length} בניינים על המפה · לחיצה על סמן פותחת את הבניין</div>
    </div>
  );
}
