import { useEffect, useMemo, useRef, useState } from 'react';
import { type Apartment, type Db, buildingKeys, displayName, getBuilding } from '@shlichus/core';
import { Icon, type IconName } from './icons';
import { useStore } from './store';
import { ConfirmHost, ToastHost } from './ui';
import { Home } from './views/Home';
import { Connections } from './views/Connections';
import { MapView } from './views/MapView';
import { Community } from './views/Community';
import { Tasks } from './views/Tasks';
import { Events } from './views/Events';
import { Donations } from './views/Donations';
import { Messages } from './views/Messages';

type View = 'today' | 'community' | 'map' | 'messages' | 'donations' | 'events' | 'tasks' | 'connections' | 'settings';

const NAV: { key: View; label: string; icon: IconName; mobile?: boolean }[] = [
  { key: 'today', label: 'היום', icon: 'sun', mobile: true },
  { key: 'community', label: 'הקהילה', icon: 'users', mobile: true },
  { key: 'map', label: 'מפה', icon: 'map', mobile: true },
  { key: 'messages', label: 'הודעות', icon: 'chat', mobile: true },
  { key: 'donations', label: 'תרומות', icon: 'heart' },
  { key: 'events', label: 'אירועים', icon: 'cal' },
  { key: 'tasks', label: 'משימות', icon: 'tasks', mobile: true },
];
const FOOT: typeof NAV = [
  { key: 'connections', label: 'חיבורים', icon: 'plug' },
  { key: 'settings', label: 'הגדרות', icon: 'gear' },
];

/** מסכים שכבר נבנו בממשק החדש */
const BUILT: View[] = ['today', 'connections', 'map', 'community', 'tasks', 'events', 'donations', 'messages'];

function viewFromHash(): View {
  const h = location.hash.replace('#', '') as View;
  return [...NAV, ...FOOT].some((n) => n.key === h) ? h : 'today';
}

export function App() {
  const { db, status, sync, syncError, load, login } = useStore();
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => setView(viewFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (v: string) => { location.hash = v; };

  if (status === 'loading') return null;
  if (!db) return <Welcome sync={sync} onLogin={() => void login()} />;

  const mission = String(db.__SETTINGS__?.missionName ?? '');
  return (
    <div className="app">
      <nav className="rail" aria-label="ניווט ראשי">
        <div className="brand">
          <div className="brand-mark">ש</div>
          <div><div className="brand-name">השליחות שלי</div>{mission && <div className="brand-sub">{mission}</div>}</div>
        </div>
        {NAV.map((n) => (
          <button key={n.key} className="nav-item" aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <Icon name={n.icon} />{n.label}
          </button>
        ))}
        <div className="rail-foot">
          {FOOT.map((n) => (
            <button key={n.key} className="nav-item" aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
              <Icon name={n.icon} />{n.label}
            </button>
          ))}
        </div>
      </nav>

      <main className={`main${view === 'map' ? ' main-map' : ''}`}>
        <div className="topbar">
          <Search db={db} />
          <SyncBadge sync={sync} error={syncError} onLogin={() => void login()} />
        </div>
        {view === 'today' && <Home db={db} onNavigate={go} />}
        {view === 'connections' && <Connections db={db} />}
        {view === 'map' && <MapView db={db} />}
        {view === 'community' && <Community db={db} />}
        {view === 'tasks' && <Tasks db={db} />}
        {view === 'events' && <Events db={db} />}
        {view === 'donations' && <Donations db={db} />}
        {view === 'messages' && <Messages db={db} />}
        {!BUILT.includes(view) && <Soon label={[...NAV, ...FOOT].find((n) => n.key === view)!.label} />}
      </main>

      <nav className="tabbar" aria-label="ניווט">
        {NAV.filter((n) => n.mobile).map((n) => (
          <button key={n.key} aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
      </nav>
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

function SyncBadge({ sync, error, onLogin }: { sync: string; error: string | null; onLogin: () => void }) {
  if (sync === 'auth-needed') return <button className="sync warn" onClick={onLogin}><Icon name="cloud" size={16} />התחברות לגוגל</button>;
  if (sync === 'error') return <span className="sync err" title={error ?? ''}><Icon name="cloud" size={16} />{error ?? 'שגיאת סנכרון'}</span>;
  if (sync === 'syncing') return <span className="sync"><Icon name="cloud" size={16} />מסנכרן…</span>;
  return <span className="sync"><Icon name="cloud" size={16} />מסונכרן</span>;
}

/** חיפוש מהיר — Ctrl+K */
function Search({ db }: { db: Db }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape') setQ('');
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);

  const all = useMemo(() => {
    const out: { name: string; bldg: string; apt: Apartment; hay: string }[] = [];
    for (const k of buildingKeys(db)) {
      for (const a of getBuilding(db, k)?.apts ?? []) {
        const name = displayName(a);
        if (a.deletedAt || !name) continue;
        out.push({ name, bldg: k, apt: a, hay: [name, k, a.father, a.mother, a.fatherPhone, a.motherPhone, a.phones].join(' ').replace(/-/g, '') });
      }
    }
    return out;
  }, [db]);
  const term = q.trim().replace(/-/g, '');
  const hits = term ? all.filter((x) => x.hay.includes(term)).slice(0, 8) : [];

  return (
    <div className="search-wrap">
      <label className="search" htmlFor="q"><Icon name="search" size={17} />
        <input id="q" ref={ref} type="search" placeholder="חיפוש משפחה, כתובת או טלפון" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <span className="kbd">Ctrl K</span>
      </label>
      {term && (
        <ul className="results">
          {hits.length === 0 && <li className="r-sub">לא נמצאו תוצאות</li>}
          {hits.map((h, i) => {
            const phone = String(h.apt.fatherPhone || h.apt.motherPhone || h.apt.phones || '');
            return (
              <li key={i}>
                <div><b>{h.name}</b><div className="r-sub">{h.bldg}{h.apt.num ? `, דירה ${h.apt.num}` : ''}</div></div>
                {phone && <span className="r-phone">{phone}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Soon({ label }: { label: string }) {
  return (
    <section className="panel soon">
      <h2>{label}</h2>
      <p>המסך הזה נבנה מחדש בעיצוב החדש. בינתיים כל האפשרויות שלו זמינות בגרסה הקיימת, על אותם נתונים.</p>
      <a className="btn" href="/shlichus/v2/">לגרסה הקיימת</a>
    </section>
  );
}

function Welcome({ sync, onLogin }: { sync: string; onLogin: () => void }) {
  return (
    <main className="main">
      <section className="panel welcome">
        <div className="brand-mark" style={{ margin: '0 auto 16px', width: 48, height: 48, fontSize: 22 }}>ש</div>
        <h1>ברוכים הבאים להשליחות שלי</h1>
        <p>המערכת שומרת את נתוני הקהילה בגוגל דרייב שלך, כך שהם תמיד שלך. התחבר כדי לטעון את הקהילה או להתחיל קהילה חדשה.</p>
        <button className="btn btn-primary" onClick={onLogin}>{sync === 'syncing' ? 'מתחבר…' : 'התחברות עם Google'}</button>
      </section>
    </main>
  );
}
