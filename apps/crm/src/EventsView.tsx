import { useMemo, useState } from 'react';
import { type Db, buildingKeys, daysUntil, formatHebrew, getBuilding, hebrewParts, liveApts } from '@shlichus/core';

interface FieldEvent {
  id?: string;
  name?: string;
  title?: string;
  date?: string;
  registrants?: { name?: string }[];
  attendance?: string[];
}

interface MilestoneRow {
  label: string;
  hebDate: string;
  gregDate: string;
  family: string;
  days: number | null;
}

export function EventsView({ db }: { db: Db }) {
  const [range, setRange] = useState(30);
  const [typeFilter, setTypeFilter] = useState('');

  const events = useMemo(
    () => ((db.meta?.events ?? []) as FieldEvent[]).slice().reverse(),
    [db]
  );

  const todayHeb = useMemo(() => {
    const h = hebrewParts(new Date());
    return h ? `${formatHebrew(h.day, h.monthName)} · היום` : '';
  }, []);

  const milestones = useMemo(() => {
    const out: MilestoneRow[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        ((a.milestones ?? []) as Record<string, unknown>[]).forEach((m) => {
          const day = Number(m.day) || 0;
          const monthName = String(m.monthName ?? '');
          out.push({
            label: String(m.label ?? m.type ?? ''),
            hebDate: day && monthName ? formatHebrew(day, monthName) : '',
            gregDate: String(m.gregDate ?? ''),
            family: a.name || key,
            days: day && monthName ? daysUntil(monthName, day) : null,
          });
        });
      });
    }
    // הקרובים קודם — לפי המופע הבא בלוח העברי
    return out.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
  }, [db]);

  const kpi = useMemo(() => ({
    month: milestones.filter((m) => m.days !== null && m.days <= 30).length,
    today: milestones.filter((m) => m.days === 0).length,
    week: milestones.filter((m) => m.days !== null && m.days <= 7).length,
    yahrzeits: milestones.filter((m) => m.label.includes('יארצייט')).length,
  }), [milestones]);

  const msTypes = useMemo(() => [...new Set(milestones.map((m) => m.label.split(' ')[0]).filter(Boolean))], [milestones]);
  const visible = milestones.filter(
    (m) => (m.days === null || m.days <= range) && (!typeFilter || m.label.startsWith(typeFilter))
  );

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-calendar-days" /> אירועי הקהילה</h2>
        {todayHeb && <span className="filter-pill" style={{ cursor: 'default' }}>{todayHeb}</span>}
        <select className="board-select" value={range} onChange={(e) => setRange(Number(e.target.value))}>
          <option value={30}>30 ימים</option>
          <option value={60}>60 ימים</option>
          <option value={400}>שנה</option>
        </select>
        <select className="board-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">כל הסוגים</option>
          {msTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="kpi-num">{kpi.month}</div><div className="kpi-label">ב-30 ימים</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--danger)' }}>{kpi.today}</div><div className="kpi-label">היום</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--warning)' }}>{kpi.week}</div><div className="kpi-label">השבוע</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: '#8b5cf6' }}>{kpi.yahrzeits}</div><div className="kpi-label">יארצייטים</div></div>
      </div>

      <h3 className="section-title">אירועים (כולל מאפליקציית השטח)</h3>
      {events.length === 0 ? (
        <p className="placeholder">אין אירועים עדיין.</p>
      ) : (
        <div className="event-cards">
          {events.map((ev, i) => (
            <div className="event-card" key={ev.id ?? i}>
              <div className="event-name">{ev.name || ev.title || 'אירוע'}</div>
              <div className="event-meta">
                {ev.date ? `${ev.date} · ` : ''}
                {ev.registrants?.length ?? 0} נרשמים · {ev.attendance?.length ?? 0} נכחו
              </div>
              {(ev.registrants?.length ?? 0) > 0 && (
                <div className="event-regs">
                  {ev.registrants!.map((r) => r.name).filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 className="section-title">ציוני דרך ותאריכים עבריים ({visible.length})</h3>
      {visible.length === 0 ? (
        <p className="placeholder">אין אירועים בטווח הנבחר — הוסף אירועים בכרטיסי המשפחות.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>אירוע</th><th>מתי</th><th>תאריך עברי</th><th>תאריך לועזי מקורי</th><th>משפחה</th></tr>
            </thead>
            <tbody>
              {visible.map((m, i) => (
                <tr key={i}>
                  <td>{m.label}</td>
                  <td>
                    {m.days === null ? '' : (
                      <span className={`contact-badge ${m.days <= 7 ? 'stale' : m.days <= 30 ? 'aging' : 'none'}`}>
                        {m.days === 0 ? 'היום!' : `בעוד ${m.days} ימים`}
                      </span>
                    )}
                  </td>
                  <td>{m.hebDate}</td>
                  <td>{m.gregDate}</td>
                  <td>{m.family}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
