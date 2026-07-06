import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { buildingKeys, getBuilding, getCategories, liveApts, type Db } from '@shlichus/core';
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
import { BuildingModal } from './BuildingModal';
import { CommandPalette } from './CommandPalette';
import { DashboardView } from './DashboardView';

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('v2_theme', theme);
}

// אותו ניווט ראשי כמו המערכת הקיימת
const MAIN_TABS = [
  { key: 'map', label: 'מפה', icon: 'fa-map-marker-alt' },
  { key: 'table', label: 'קהילה', icon: 'fa-users' },
  { key: 'activity', label: 'פעילות', icon: 'fa-bolt' },
  { key: 'comm', label: 'תקשורת', icon: 'fa-bullhorn' },
  { key: 'donations', label: 'תרומות', icon: 'fa-hand-holding-heart' },
] as const;

const ACTIVITY_SUBS = [
  { key: 'dashboard', label: 'לוח בקרה' },
  { key: 'tasks', label: 'משימות' },
  { key: 'events', label: 'אירועים' },
  { key: 'kanban', label: 'פרויקטים' },
  { key: 'circles', label: 'מעגלים' },
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

/** דיאגרמת מבנים לפי קטגוריה — כמו ה-widget בישן, ב-conic-gradient */
function BuildingsPie({ db }: { db: Db }) {
  const cats = getCategories(db);
  const counts = new Map<string, number>();
  for (const key of buildingKeys(db)) {
    const info = getBuilding(db, key)?.info;
    const cat = String(info?.categoryId ?? info?.category ?? 'residential');
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (!total) return null;
  let acc = 0;
  const stops: string[] = [];
  const legend: { name: string; color: string; n: number }[] = [];
  for (const c of cats) {
    const n = counts.get(c.id) ?? 0;
    if (!n) continue;
    const from = (acc / total) * 360;
    acc += n;
    stops.push(`${c.color} ${from}deg ${(acc / total) * 360}deg`);
    legend.push({ name: c.name, color: c.color, n });
  }
  return (
    <div className="side-section">
      <h4>מבנים לפי קטגוריה ({total})</h4>
      <div className="pie-row">
        <div className="pie" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
        <div className="pie-legend">
          {legend.map((l) => (
            <div key={l.name}>
              <span className="dot" style={{ background: l.color }} /> {l.name} · {l.n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
  const [activitySub, setActivitySub] = useState<string>('dashboard');
  const [tableQuery, setTableQuery] = useState('');
  const [openBldg, setOpenBldg] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void load();
    applyTheme(localStorage.getItem('v2_theme') ?? 'light');
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [load]);

  const toggleDark = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  const alerts = useMemo(() => (db ? upcomingAlerts(db) : []), [db]);

  const openTableWith = (q: string) => {
    setTableQuery(q);
    setView('table');
  };

  return (
    <div className="shell">
      <main className="main-area">
        <div className="topbar">
          <div className="top-search" onClick={() => setPaletteOpen(true)} style={{ cursor: 'pointer' }}>
            <i className="fas fa-search" />
            <input
              placeholder="חיפוש מהיר"
              value={view === 'table' ? tableQuery : ''}
              onChange={(e) => openTableWith(e.target.value)}
            />
            <kbd style={{ fontSize: 10, border: '1px solid var(--line)', borderRadius: 5, padding: '1px 6px' }}>Ctrl+K</kbd>
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
                  <MapView db={db} onOpenBuilding={setOpenBldg} />
                </Suspense>
              )}
              {openBldg && <BuildingModal db={db} bldg={openBldg} onClose={() => setOpenBldg(null)} />}
              {paletteOpen && (
                <CommandPalette
                  db={db}
                  onNavigate={setView}
                  onOpenFamily={openTableWith}
                  onToggleDark={toggleDark}
                  onSync={() => void pullFromCloud()}
                  onClose={() => setPaletteOpen(false)}
                />
              )}
              {view === 'table' && <FamiliesTable db={db} initialQuery={tableQuery} />}
              {view === 'activity' && activitySub === 'dashboard' && <DashboardView db={db} onOpenFamily={openTableWith} />}
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
            title="מצב כהה/בהיר"
            onClick={toggleDark}
          >
            <i className="fas fa-moon" />
          </button>
          <button
            className="close-btn"
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

        {db && <BuildingsPie db={db} />}

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

        <button
          className="fab"
          title="משפחה חדשה"
          onClick={() => {
            // מעבר לקהילה — כפתור "משפחה חדשה" שם פותח כרטיס ריק
            setView('table');
            setTimeout(() => (document.querySelector('.table-toolbar .edit-btn') as HTMLButtonElement)?.click(), 80);
          }}
        >
          <i className="fas fa-plus" />
        </button>
      </aside>
    </div>
  );
}
