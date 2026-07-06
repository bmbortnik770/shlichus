import { lazy, Suspense, useEffect, useState } from 'react';
import { buildingKeys } from '@shlichus/core';
import { useCrm, familyCount } from './store';
import { FamiliesTable } from './FamiliesTable';
import { TasksView } from './TasksView';
import { DonationsView } from './DonationsView';

// המפה נטענת עצלה — mapbox-gl כבד ולא נחוץ בשאר המסכים
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

const VIEWS = [
  { key: 'map', label: 'מפה' },
  { key: 'table', label: 'רשימת משפחות' },
  { key: 'tasks', label: 'משימות' },
  { key: 'donations', label: 'תרומות' },
  { key: 'comm', label: 'מרכז תקשורת' },
] as const;

const SYNC_LABEL: Record<string, string> = {
  offline: 'מקומי',
  syncing: 'מסתנכרן…',
  synced: 'מסונכרן עם הענן',
  'auth-needed': 'לא מחובר',
  error: 'שגיאת סנכרון',
};

export function App() {
  const { db, status, load, sync, syncError, login, pullFromCloud } = useCrm();
  const [view, setView] = useState<string>('table');
  const [tableQuery, setTableQuery] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>השליחות שלי</h1>
        <nav>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`nav-item ${view === v.key ? 'active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="sync-box">
          <span className={`sync-chip sync-${sync}`}>{SYNC_LABEL[sync]}</span>
          {sync === 'auth-needed' && (
            <button className="login-btn" onClick={() => void login()}>התחברות Google</button>
          )}
          {sync === 'synced' && (
            <button className="login-btn" onClick={() => void pullFromCloud()}>משוך מהענן</button>
          )}
          {syncError && <span className="sync-err">{syncError}</span>}
        </div>
        <p className="beta-note">
          גרסת v2 בבנייה — המערכת הקיימת ממשיכה לעבוד במקביל על אותם נתונים.
        </p>
      </aside>
      <main className="content">
        {status === 'loading' && <p>טוען נתונים…</p>}
        {status === 'empty' && (
          <div>
            <p>אין עדיין נתונים מקומיים בדפדפן הזה.</p>
            <p>
              {sync === 'auth-needed'
                ? 'התחבר ל-Google בכפתור משמאל כדי למשוך את הנתונים מהענן.'
                : 'המערכת הקיימת ממשיכה לעבוד כרגיל.'}
            </p>
          </div>
        )}
        {status === 'ready' && db && (
          <>
            <section className="kpi-row">
              <div className="kpi">
                <div className="kpi-num">{familyCount(db)}</div>
                <div className="kpi-label">משפחות</div>
              </div>
              <div className="kpi">
                <div className="kpi-num">{buildingKeys(db).length}</div>
                <div className="kpi-label">בניינים</div>
              </div>
            </section>
            {view === 'table' && <FamiliesTable db={db} initialQuery={tableQuery} />}
            {view === 'map' && (
              <Suspense fallback={<p className="placeholder">טוען מפה…</p>}>
                <MapView
                  db={db}
                  onOpenBuilding={(key) => {
                    setTableQuery(key);
                    setView('table');
                  }}
                />
              </Suspense>
            )}
            {view === 'tasks' && <TasksView db={db} />}
            {view === 'donations' && <DonationsView db={db} />}
            {view === 'comm' && (
              <p className="placeholder">מרכז התקשורת יעבור בשלב הבא של ההגירה — בינתיים במערכת הקיימת.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
