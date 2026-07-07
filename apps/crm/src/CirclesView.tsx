import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';
import { useCrm } from './store';

interface Circle {
  id?: string;
  name?: string;
  color?: string;
}

const CIRCLE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6'];

/** מעגלי קשר — CRUD מלא כמו circles-hub בישן (connectionCircles) */
export function CirclesView({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const updateApt = useCrm((s) => s.updateApt);
  const circles = ((db.__SETTINGS__?.connectionCircles ?? []) as Circle[]);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const families = useMemo(() => {
    const out: { key: string; bldg: string; idx: number; name: string; circles: string[] }[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        out.push({
          key: `${key}|${entry.apts.indexOf(a)}`, bldg: key, idx: entry.apts.indexOf(a),
          name: a.name || key,
          circles: ((a.connectionCircles ?? []) as (string | { id?: string })[]).map((e) => typeof e === 'string' ? e : (e.id ?? '')),
        });
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [db]);

  const newCircle = () => {
    const name = window.prompt('שם המעגל החדש:');
    if (!name?.trim()) return;
    void updateSettings({
      connectionCircles: [...circles, { id: 'c_' + Date.now(), name: name.trim(), color: CIRCLE_COLORS[circles.length % CIRCLE_COLORS.length] }],
    });
  };

  const deleteCircle = (id: string) => {
    if (!window.confirm('למחוק את המעגל? (החברים לא יימחקו)')) return;
    void updateSettings({ connectionCircles: circles.filter((c) => c.id !== id) });
  };

  const addMember = async (circleId: string, famKey: string) => {
    const [bldg, idxStr] = famKey.split('|');
    const apt = getBuilding(db, bldg!)?.apts[Number(idxStr)];
    if (!apt) return;
    const cur = ((apt.connectionCircles ?? []) as unknown[]);
    await updateApt(bldg!, Number(idxStr), { connectionCircles: [...cur, circleId] } as never);
    setAddingTo(null);
  };

  const removeMember = async (circleId: string, f: (typeof families)[number]) => {
    const apt = getBuilding(db, f.bldg)?.apts[f.idx];
    if (!apt) return;
    const next = ((apt.connectionCircles ?? []) as (string | { id?: string })[])
      .filter((e) => (typeof e === 'string' ? e : e.id) !== circleId);
    await updateApt(f.bldg, f.idx, { connectionCircles: next } as never);
  };

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-circle-nodes" /> מעגלי קשר</h2>
        <button className="edit-btn" onClick={newCircle}><i className="fas fa-plus" /> מעגל חדש</button>
        <span className="count">{circles.length} מעגלים</span>
      </div>
      {circles.length === 0 ? (
        <p className="placeholder">אין מעגלי קשר עדיין — צור את הראשון.</p>
      ) : (
        <div className="event-cards">
          {circles.map((c, i) => {
            const members = families.filter((f) => f.circles.includes(c.id ?? ''));
            const candidates = families.filter((f) => !f.circles.includes(c.id ?? ''));
            return (
              <div className="event-card" key={c.id ?? i} style={{ borderInlineStart: `4px solid ${c.color ?? '#3b82f6'}` }}>
                <div className="drawer-head" style={{ marginBottom: 4 }}>
                  <div className="event-name">{c.name ?? 'מעגל'}</div>
                  <button className="chip-x" title="מחיקת מעגל" onClick={() => deleteCircle(c.id!)}>✕</button>
                </div>
                <div className="event-meta">{members.length} חברים</div>
                <ul className="tpl-list" style={{ marginTop: 8 }}>
                  {members.map((f) => (
                    <li key={f.key} style={{ padding: '5px 10px' }}>
                      <span>{f.name}</span>
                      <button className="chip-x" title="הסרה מהמעגל" onClick={() => void removeMember(c.id!, f)}>✕</button>
                    </li>
                  ))}
                </ul>
                {addingTo === c.id ? (
                  <select
                    className="board-select" autoFocus defaultValue=""
                    onChange={(e) => { if (e.target.value) void addMember(c.id!, e.target.value); }}
                    onBlur={() => setAddingTo(null)}
                  >
                    <option value="" disabled>בחר משפחה…</option>
                    {candidates.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
                  </select>
                ) : (
                  <button className="login-btn" style={{ marginTop: 6 }} onClick={() => setAddingTo(c.id!)}>
                    <i className="fas fa-user-plus" /> הוסף חבר/ה
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
