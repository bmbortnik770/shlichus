import { useEffect } from 'react';
import { buildingKeys } from '@shlichus/core';
import { useCrm, familyCount } from './store';

const VIEWS = [
  { key: 'map', label: 'מפה' },
  { key: 'table', label: 'רשימת משפחות' },
  { key: 'comm', label: 'מרכז תקשורת' },
  { key: 'activity', label: 'מרכז פעילות' },
  { key: 'donations', label: 'תרומות' },
] as const;

export function App() {
  const { db, status, load } = useCrm();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>השליחות שלי</h1>
        <nav>
          {VIEWS.map((v) => (
            <button key={v.key} className="nav-item">
              {v.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {status === 'loading' && <p>טוען נתונים…</p>}
        {status === 'empty' && (
          <p>
            אין עדיין נתונים מקומיים. בגרסה הבאה: התחברות Google וטעינה מהענן — בינתיים המערכת
            הקיימת ממשיכה לעבוד כרגיל.
          </p>
        )}
        {status === 'ready' && db && (
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
        )}
      </main>
    </div>
  );
}
