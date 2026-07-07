import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { DialogHost } from './dialog';

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

/** חיתוך סגנונות המשפחות — כמו ה-doughnut בישן (stats לפי style) */
function StylesPie({ db }: { db: Db }) {
  const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];
  const styleColors = (db.__SETTINGS__?.styleColors ?? {}) as Record<string, string>;
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];
  const counts = new Map<string, number>();
  for (const key of buildingKeys(db)) {
    liveApts(getBuilding(db, key)?.apts).forEach((a) => {
      const st = a.style || 'ללא סגנון';
      counts.set(st, (counts.get(st) ?? 0) + 1);
    });
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (!total) return null;
  const color = (st: string) => {
    if (styleColors[st]) return styleColors[st];
    const idx = styles.indexOf(st);
    return idx === -1 ? '#94a3b8' : CHART_COLORS[idx % CHART_COLORS.length]!;
  };
  let acc = 0;
  const stops: string[] = [];
  const legend: { name: string; c: string; n: number }[] = [];
  for (const [st, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const from = (acc / total) * 360;
    acc += n;
    stops.push(`${color(st)} ${from}deg ${(acc / total) * 360}deg`);
    legend.push({ name: st, c: color(st), n });
  }
  return (
    <div className="side-section">
      <h4>חיתוך סגנונות ({total})</h4>
      <div className="pie-row">
        <div className="pie donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
        <div className="pie-legend">
          {legend.map((l) => (
            <div key={l.name}><span className="dot" style={{ background: l.c }} /> {l.name} · {l.n}</div>
          ))}
        </div>
      </div>
    </div>
  );
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

/** התראות השבוע — כמו kpiAlerts בישן: ימי הולדת החודש + משימות פתוחות עם ✓ */
interface AlertItem { kind: 'task' | 'bday'; text: string; bldg?: string; idx?: number; taskIdx?: number }
function weekAlerts(db: Db): AlertItem[] {
  const out: AlertItem[] = [];
  const month = new Date().getMonth();
  for (const key of buildingKeys(db)) {
    const entry = getBuilding(db, key);
    if (!entry) continue;
    liveApts(entry.apts).forEach((a) => {
      const idx = entry.apts.indexOf(a);
      (a.childrenList ?? []).forEach((ch) => {
        const dob = (ch as { dob?: string }).dob;
        if (dob && new Date(dob).getMonth() === month) out.push({ kind: 'bday', text: `${ch.name ?? ''} (משפ׳ ${a.name ?? ''}) חוגג/ת החודש 🎂` });
      });
      (a.tasks ?? []).forEach((t, ti) => {
        if (!t.done) out.push({ kind: 'task', text: `משפ׳ ${a.name ?? key}: ${t.text ?? ''}`, bldg: key, idx, taskIdx: ti });
      });
    });
  }
  return out.slice(0, 6);
}

export function App() {
  const { db, status, load, sync, syncError, login, pullFromCloud } = useCrm();
  const [view, setView] = useState<string>('map');
  const [activitySub, setActivitySub] = useState<string>('dashboard');
  const [tableQuery, setTableQuery] = useState('');
  const [openBldg, setOpenBldg] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const [sideAddr, setSideAddr] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gStyle, setGStyle] = useState('');
  const [gTag, setGTag] = useState('');

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

  const alerts = useMemo(() => (db ? weekAlerts(db) : []), [db]);
  const updateApt = useCrm((st) => st.updateApt);

  // צבע ערכת נושא מההגדרות — כמו appSettings.themeColor בישן
  useEffect(() => {
    const c = db?.__SETTINGS__?.themeColor;
    if (typeof c === 'string' && c) document.documentElement.style.setProperty('--accent', c);
  }, [db]);

  // מסך פתיחה מההגדרות — כמו currentMainView = appSettings.defaultView בישן
  const appliedDefaultView = useRef(false);
  useEffect(() => {
    if (db && !appliedDefaultView.current) {
      appliedDefaultView.current = true;
      const dv = String(db.__SETTINGS__?.defaultView ?? 'map');
      setView(dv === 'kanban' ? 'activity' : dv);
      if (dv === 'kanban') setActivitySub('kanban');
    }
  }, [db]);

  const openTableWith = (q: string) => {
    setTableQuery(q);
    setView('table');
  };

  return (
    <div className="shell">
      <DialogHost />
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

        {db && (
          <div className="filter-row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <label className="filter-pill">
              <i className="fas fa-palette" /> סגנון
              <select value={gStyle} onChange={(e) => setGStyle(e.target.value)}>
                <option value="">הכל</option>
                {((db.__SETTINGS__?.styles ?? []) as string[]).map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
            <label className="filter-pill">
              <i className="fas fa-tags" /> תגיות
              <select value={gTag} onChange={(e) => setGTag(e.target.value)}>
                <option value="">הכל</option>
                {((db.__SETTINGS__?.tags ?? []) as string[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            {(gStyle || gTag) && (
              <button className="aud-chip active" onClick={() => { setGStyle(''); setGTag(''); }}>
                נקה פילטרים ✕
              </button>
            )}
          </div>
        )}

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
                  <MapView db={db} onOpenBuilding={setOpenBldg} filterStyle={gStyle} filterTag={gTag} flyTo={flyTo} />
                </Suspense>
              )}
              {openBldg && <BuildingModal db={db} bldg={openBldg} onClose={() => setOpenBldg(null)} />}
              {paletteOpen && (
                <CommandPalette
                  db={db}
                  onNavigate={(v) => (v === 'settings' ? setSettingsOpen(true) : setView(v))}
                  onOpenFamily={openTableWith}
                  onToggleDark={toggleDark}
                  onSync={() => void pullFromCloud()}
                  onClose={() => setPaletteOpen(false)}
                />
              )}
              {view === 'table' && <FamiliesTable db={db} initialQuery={tableQuery} onOpenBuilding={setOpenBldg} filterStyle={gStyle} filterTag={gTag} />}
              {view === 'activity' && activitySub === 'dashboard' && <DashboardView db={db} onOpenFamily={openTableWith} />}
              {view === 'activity' && activitySub === 'tasks' && <TasksView db={db} onOpenFamily={openTableWith} />}
              {view === 'activity' && activitySub === 'events' && <EventsView db={db} />}
              {view === 'activity' && activitySub === 'kanban' && <KanbanView db={db} />}
              {view === 'activity' && activitySub === 'circles' && <CirclesView db={db} />}
              {view === 'comm' && <CommView db={db} />}
              {view === 'donations' && <DonationsView db={db} onOpenFamily={openTableWith} />}
              {settingsOpen && (
                <div className="drawer-backdrop" onClick={() => setSettingsOpen(false)}>
                  <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                    <header className="drawer-head" style={{ marginBottom: 10 }}>
                      <h2><i className="fas fa-sliders" style={{ color: 'var(--accent)', marginInlineEnd: 8 }} />הגדרות מערכת</h2>
                      <button className="close-btn" onClick={() => setSettingsOpen(false)} aria-label="סגירה">✕</button>
                    </header>
                    <SettingsView db={db} />
                  </div>
                </div>
              )}
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
            onClick={() => setSettingsOpen(true)}
          >
            <i className="fas fa-cog" />
          </button>
        </div>

        <div className="welcome-banner">ברוך הבא למערכת! כאן מתחילים להפוך את העולם 🌍</div>

        <div className="side-search">
          <i className="fas fa-search" />
          <input
            placeholder="📍 חפש אזור/כתובת במפה…"
            value={sideAddr}
            onChange={(e) => setSideAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !sideAddr.trim()) return;
              void (async () => {
                const token = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
                const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(sideAddr.trim())}.json?country=il&language=he&access_token=${token}`);
                const d = (await r.json()) as { features?: { center: [number, number] }[] };
                if (d.features?.[0]) { setView('map'); setFlyTo([...d.features[0].center] as [number, number]); }
              })();
            }}
          />
        </div>



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

        {db && <StylesPie db={db} />}
        {db && <BuildingsPie db={db} />}

        {alerts.length > 0 && (
          <div className="side-section">
            <h4>התראות השבוע:</h4>
            {alerts.map((a, i) => (
              <div className="alert-item" key={i}>
                {a.kind === 'task' ? <i className="fas fa-tasks" style={{ color: 'var(--accent)' }} /> : <i className="fas fa-birthday-cake" style={{ color: 'var(--warning)' }} />}
                <span style={{ flex: 1 }}>{a.text}</span>
                {a.kind === 'task' && (
                  <button
                    className="task-done-btn" title="סמן כבוצע"
                    onClick={() => {
                      const apt = getBuilding(db!, a.bldg!)?.apts[a.idx!];
                      if (!apt) return;
                      void updateApt(a.bldg!, a.idx!, { tasks: (apt.tasks ?? []).map((t, ti) => ti === a.taskIdx ? { ...t, done: true } : t) });
                    }}
                  ><i className="fas fa-check" /></button>
                )}
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
