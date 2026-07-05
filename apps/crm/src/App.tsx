import { useEffect, useState } from 'react';
import { buildingKeys } from '@shlichus/core';
import { useCrm, familyCount } from './store';
import { FamiliesTable } from './FamiliesTable';

const VIEWS = [
  { key: 'map', label: 'מפה' },
  { key: 'table', label: 'רשימת משפחות' },
  { key: 'comm', label: 'מרכז תקשורת' },
  { key: 'activity', label: 'מרכז פעילות' },
  { key: 'donations', label: 'תרומות' },
] as const;

export function App() {
  const { db, status, load } = useCrm();
  const [view, setView] = useState<string>('table');

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
        <p className="beta-note">
          גרסת v2 בבנייה — המערכת הקיימת ממשיכה לעבוד במקביל על אותם נתונים.
        </p>
      </aside>
      <main className="content">
        {status === 'loading' && <p>טוען נתונים…</p>}
        {status === 'empty' && (
          <p>
            אין עדיין נתונים מקומיים בדפדפן הזה. בגרסה הבאה: התחברות Google וטעינה מהענן —
            בינתיים המערכת הקיימת ממשיכה לעבוד כרגיל.
          </p>
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
            {view === 'table' ? (
              <FamiliesTable db={db} />
            ) : (
              <p className="placeholder">מסך «{VIEWS.find((v) => v.key === view)?.label}» יעבור בשלב הבא של ההגירה.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
