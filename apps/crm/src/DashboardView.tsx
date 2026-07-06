import { useMemo } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

/** לוח בקרה — כמו renderActivityDashboard בישן: KPI + דחופים + פעילות אחרונה */
export function DashboardView({ db, onOpenFamily }: { db: Db; onOpenFamily: (q: string) => void }) {
  const stats = useMemo(() => {
    let families = 0, openTasks = 0, donMonth = 0;
    const urgent: { name: string; days: number | null }[] = [];
    const recent: { date: string; type: string; text: string; name: string }[] = [];
    const monthStart = new Date();
    monthStart.setDate(1);
    const cutoff = Date.now() - 30 * 86400000;

    for (const key of buildingKeys(db)) {
      liveApts(getBuilding(db, key)?.apts).forEach((a) => {
        families++;
        openTasks += (a.tasks ?? []).filter((t) => !t.done).length;
        (a.donations ?? []).forEach((d) => {
          if (new Date(String(d.date ?? '')) >= monthStart) donMonth += Number(d.amount) || 0;
        });
        const latest = (a.interactions ?? []).reduce((max, i) => {
          const t = new Date(i.date ?? '').getTime();
          return isNaN(t) ? max : Math.max(max, t);
        }, 0);
        if (latest < cutoff) {
          urgent.push({ name: a.name || key, days: latest ? Math.floor((Date.now() - latest) / 86400000) : null });
        }
        (a.interactions ?? []).slice(0, 3).forEach((l) => {
          recent.push({ date: String(l.date ?? ''), type: String(l.type ?? ''), text: String(l.text ?? l.notes ?? ''), name: a.name || key });
        });
      });
    }
    openTasks += ((db.meta?.generalTasks ?? []) as { done?: boolean }[]).filter((t) => !t.done).length;
    recent.sort((a, b) => b.date.localeCompare(a.date));
    return { families, openTasks, donMonth, urgent: urgent.slice(0, 8), recent: recent.slice(0, 8) };
  }, [db]);

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-gauge-high" /> לוח בקרה</h2>
      </div>
      <div className="kpi-row">
        <div className="kpi"><div className="kpi-num">{stats.families}</div><div className="kpi-label">משפחות בקהילה</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--danger)' }}>{stats.urgent.length}</div><div className="kpi-label">לטיפול דחוף</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--warning)' }}>{stats.openTasks}</div><div className="kpi-label">משימות פתוחות</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--success)' }}>{stats.donMonth.toLocaleString('he-IL')} ₪</div><div className="kpi-label">תרומות החודש</div></div>
      </div>

      <div className="dash-cols">
        <div className="settings-card">
          <h3><i className="fas fa-bell" /> לטיפול דחוף — בלי קשר 30+ יום</h3>
          {stats.urgent.length === 0 ? <p className="placeholder">הכל בשליטה 👏</p> : (
            <ul className="tpl-list">
              {stats.urgent.map((u, i) => (
                <li key={i} style={{ cursor: 'pointer' }} onClick={() => onOpenFamily(u.name)}>
                  <div><strong>{u.name}</strong>
                    <div className="tpl-text">{u.days === null ? 'אין תיעוד קשר בכלל' : `קשר אחרון לפני ${u.days} ימים`}</div>
                  </div>
                  <i className="fas fa-chevron-left" style={{ color: 'var(--ink-faint)' }} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="settings-card">
          <h3><i className="fas fa-clock-rotate-left" /> פעילות אחרונה</h3>
          {stats.recent.length === 0 ? <p className="placeholder">אין תיעודים עדיין.</p> : (
            <ul className="tpl-list">
              {stats.recent.map((r, i) => (
                <li key={i}>
                  <div><strong>{r.name}</strong> <span className="tpl-text">{r.type}</span>
                    <div className="tpl-text">{r.text.slice(0, 60)}</div>
                  </div>
                  <span className="tpl-text" style={{ whiteSpace: 'nowrap' }}>{r.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
