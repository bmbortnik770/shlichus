import { useMemo } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

interface Circle {
  id?: string;
  name?: string;
  color?: string;
  icon?: string;
}

export function CirclesView({ db }: { db: Db }) {
  const circles = ((db.__SETTINGS__?.connectionCircles ?? []) as Circle[]);

  const members = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        ((a.connectionCircles ?? []) as (string | { id?: string })[]).forEach((e) => {
          const id = typeof e === 'string' ? e : (e.id ?? '');
          if (!id) return;
          if (!map.has(id)) map.set(id, []);
          map.get(id)!.push(a.name || key);
        });
      });
    }
    return map;
  }, [db]);

  if (circles.length === 0) {
    return (
      <section>
        <div className="table-toolbar"><h2 className="view-title">מעגלי קשר</h2></div>
        <p className="placeholder">אין מעגלי קשר עדיין — אפשר ליצור במערכת הקיימת.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">מעגלי קשר</h2>
        <span className="count">{circles.length} מעגלים</span>
      </div>
      <div className="event-cards">
        {circles.map((c, i) => {
          const list = members.get(c.id ?? '') ?? [];
          return (
            <div className="event-card" key={c.id ?? i} style={{ borderInlineStartColor: c.color, borderInlineStartWidth: 4 }}>
              <div className="event-name">{c.name ?? 'מעגל'}</div>
              <div className="event-meta">{list.length} חברים</div>
              {list.length > 0 && <div className="event-regs">{list.join(' · ')}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
