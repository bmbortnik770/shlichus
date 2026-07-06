import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { buildingKeys, getBuilding, liveApts, type Db } from '@shlichus/core';
import { useCrm, familyCount } from './store';
import { FamiliesTable } from './FamiliesTable';
import { TasksView } from './TasksView';
import { DonationsView } from './DonationsView';
import { EventsView } from './EventsView';
import { KanbanView } from './KanbanView';
import { CommView } from './CommView';
import { SettingsView } from './SettingsView';
import { CirclesView } from './CirclesView';

// המפה נטענת עצלה — mapbox-gl כבד ולא נחוץ בשאר המסכים
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

// אותו ניווט ראשי כמו המערכת הקיימת
const MAIN_TABS = [
  { key: 'map', label: 'מפה', icon: 'fa-map-marker-alt' },
  { key: 'table', label: 'קהילה', icon: 'fa-users' },
  { key: 'activity', label: 'פעילות', icon: 'fa-bolt' },
  { key: 'comm', label: 'תקשורת', icon: 'fa-bullhorn' },
  { key: 'donations', label: 'תרומות', icon: 'fa-hand-holding-heart' },
] as const;

const ACTIVITY_SUBS = [
  { key: 'tasks', label: 'משימות' },
  { key: 'events', label: 'אירועים' },
  { key: 'kanban', label: 'קנבן' },
  { key: 'circles', label: 'מעגלי קשר' },
] as const;

const SYNC_LABEL: Record<string, string> = {
  offline: 'מצב מקומי',
  syncing: 'שומר…',
  synced: 'מסונכרן',
  'auth-needed': 'לא מחובר',
  error: 'שגיאת סנכרון',
};

/** משפחות ללא קשר ב-30 הימים האחרונים — "לטיפול דחוף" כמו במערכת */
function urgentCount(db: Db): number {
  const cutoff = Date.now() - 30 * 86400000;
  let n = 0;
  for (const key of buildingKeys(db)) {
    liveApts(getBuilding(db, key)?.apts).forEach((a) => {
      const latest = (a.interactions ?? []).reduce((max, i) => {
        const t = new Date(i.date ?? '').getTime();
        return isNaN(t) ? max : Math.max(max, t);
      }, 0);
      if (latest < cutoff) n++;
    });
  }
  return n;
}

/** ציוני דרך קרובים (30 יום) להתראות השבוע */
function upcomingAlerts(db: Db): string[] {
  const out: { when: string; text: string }[] = [];
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86400000);
  for (const key of buildingKeys(db)) {
    liveApts(getBuilding(db, key)?.apts).forEach((a) => {
      ((a.milestones ?? []) as Record<string, unknown>[]).forEach((m) => {
        const g = new Date(String(m.gregDate ?? ''));
        if (!isNaN(g.getTime()) && g >= now && g <= horizon) {
          out.push({ when: g.toISOString(), text: `${m.label ?? 'אירוע'} — ${a.name ?? key}` });
        }
      });
    });
  }
  return out.sort((x, y) => x.when.localeCompare(y.when)).slice(0, 4).map((x) => x.text);
}

export function App() {
  const { db, status, load, sync, syncError, login, pullFromCloud } = useCrm();
  const [view, setView] = useState<string>('map');
  const [activitySub, setActivitySub] = useState<string>('tasks');
  const [tableQuery, setTableQuery] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const alerts = useMemo(() => (db ? upcomingAlerts(db) : []), [db]);

  const openTableWith = (q: string) => {
    setTableQuery(q);
    setView('table');
  };

  return (
    <div className="shell">
      <main className="main-area">
        <div className="topbar">
          <div className="top-search">
            <i className="fas fa-search" />
            <input
              placeholder="חיפוש מהיר"
              value={view === 'table' ? tableQuery : ''}
              onChange={(e) => openTableWith(e.target.value)}
            />
          </div>
          <nav className="top-nav">
            {MAIN_TABS.map((t) => (
              <button
                key={t.key}
                className={`nav-item ${view === t.key ? 'active' : ''}`}
                onClick={() => setView(t.key)}
              >
                <i className={`fas ${t.icon}`} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {view === 'activity' && (
          <div className="sub-nav">
            {ACTIVITY_SUBS.map((s) => (
              <button
                key={s.key}
                className={activitySub === s.key ? 'active' : ''}
                onClick={() => setActivitySub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="content">
          {status === 'loading' && <p className="placeholder">טוען נתונים…</p>}
          {status === 'empty' && (
            <div className="placeholder">
              <p>אין עדיין נתונים מקומיים בדפדפן הזה.</p>
              <p>{sync === 'auth-needed' ? 'התחבר ל-Google בסרגל הצד כדי למשוך את הנתונים מהענן.' : ''}</p>
            </div>
          )}
          {status === 'ready' && db && (
            <>
              {view === 'map' && (
                <Suspense fallback={<p className="placeholder">טוען מפה…</p>}>
                  <MapView db={db} onOpenBuilding={openTableWith} />
                </Suspense>
              )}
              {view === 'table' && <FamiliesTable db={db} initialQuery={tableQuery} />}
              {view === 'activity' && activitySub === 'tasks' && <TasksView db={db} />}
              {view === 'activity' && activitySub === 'events' && <EventsView db={db} />}
              {view === 'activity' && activitySub === 'kanban' && <KanbanView db={db} />}
              {view === 'activity' && activitySub === 'circles' && <CirclesView db={db} />}
              {view === 'comm' && <CommView db={db} />}
              {view === 'donations' && <DonationsView db={db} />}
              {view === 'settings' && <SettingsView db={db} />}
            </>
          )}
        </div>
      </main>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><i className="fas fa-synagogue" /></div>
          <div>
            <div className="brand-name">השליחות שלי</div>
            <div className="brand-sub">מערכת CRM מתקדמת · v2</div>
          </div>
          <button
            className="close-btn"
            style={{ marginInlineStart: 'auto' }}
            title="הגדרות"
            onClick={() => setView('settings')}
          >
            <i className="fas fa-cog" />
          </button>
        </div>

        <div className="welcome-banner">ברוך הבא למערכת! כאן מתחילים להפוך את העולם 🌍</div>

        {db && (
          <div className="widget-row">
            <div className="widget">
              <div className="widget-icon"><i className="fas fa-users" /></div>
              <div className="widget-num">{familyCount(db)}</div>
              <div className="widget-label">משפחות בקהילה</div>
            </div>
            <div className="widget alert">
              <div className="widget-icon"><i className="fas fa-bell" /></div>
              <div className="widget-num">{urgentCount(db)}</div>
              <div className="widget-label">לטיפול דחוף</div>
            </div>
          </div>
        )}

        {alerts.length > 0 && (
          <div className="side-section">
            <h4>התראות השבוע:</h4>
            {alerts.map((a, i) => (
              <div className="alert-item" key={i}>
                <i className="fas fa-calendar-day" /> {a}
              </div>
            ))}
          </div>
        )}

        <div className="sync-box">
          <span className={`sync-chip sync-${sync}`}>{SYNC_LABEL[sync]}</span>
          {sync === 'auth-needed' && (
            <button className="login-btn" onClick={() => void login()}>
              <i className="fab fa-google" /> התחברות Google
            </button>
          )}
          {sync === 'synced' && (
            <button className="login-btn" onClick={() => void pullFromCloud()}>
              <i className="fas fa-sync-alt" /> סנכרן עכשיו
            </button>
          )}
          {syncError && <span className="sync-err">{syncError}</span>}
          <p className="beta-note">
            גרסת v2 — רצה במקביל למערכת הקיימת, על אותם נתונים בדיוק.
          </p>
        </div>

        <button className="fab" title="מעבר לקהילה" onClick={() => setView('table')}>
          <i className="fas fa-plus" />
        </button>
      </aside>
    </div>
  );
}
