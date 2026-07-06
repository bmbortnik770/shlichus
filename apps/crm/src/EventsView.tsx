import { useMemo } from 'react';
import { type Db, buildingKeys, daysUntil, formatHebrew, getBuilding, liveApts } from '@shlichus/core';

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
  const events = useMemo(
    () => ((db.meta?.events ?? []) as FieldEvent[]).slice().reverse(),
    [db]
  );

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

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">אירועים ומועדים</h2>
        <span className="count">{events.length} אירועים · {milestones.length} ציוני דרך</span>
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

      <h3 className="section-title">ציוני דרך ותאריכים עבריים</h3>
      {milestones.length === 0 ? (
        <p className="placeholder">אין ציוני דרך עדיין.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>אירוע</th><th>מתי</th><th>תאריך עברי</th><th>תאריך לועזי מקורי</th><th>משפחה</th></tr>
            </thead>
            <tbody>
              {milestones.map((m, i) => (
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
