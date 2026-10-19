import { useEffect, useState } from 'react';
import { getBuilding } from '@shlichus/core';
import { Icon, type IconName } from './icons';
import { onFieldUpdates, useStore } from './store';
import { ConfirmHost, ToastHost, useToast } from './ui';
import { type CommunityTab, type View, go, parseHash, useNav } from './nav';
import { Home } from './views/Home';
import { Connections } from './views/Connections';
import { Tasks } from './views/Tasks';
import { Events } from './views/Events';
import { Donations } from './views/Donations';
import { Messages } from './views/Messages';
import { Settings } from './views/Settings';
import { FamilyCard } from './views/FamilyCard';
import { Palette } from './views/Palette';
import { ActivityHub, CommunityShell, More } from './views/Shell';
import { applyAccent } from './accent';

interface NavItem { key: View; label: string; icon: IconName }
/** מבנה התפריט: מה לעשות עכשיו → האנשים (על המפה) → הודעות → כלי הפעילות */
const MAIN: NavItem[] = [
  { key: 'today', label: 'היום', icon: 'sun' },
  { key: 'community', label: 'הקהילה', icon: 'map' },
  { key: 'messages', label: 'הודעות', icon: 'chat' },
];
const ACTIVITY: NavItem[] = [
  { key: 'tasks', label: 'משימות ופרויקטים', icon: 'tasks' },
  { key: 'events', label: 'אירועים', icon: 'cal' },
  { key: 'donations', label: 'תרומות', icon: 'heart' },
];
const FOOT: NavItem[] = [
  { key: 'connections', label: 'חיבורים', icon: 'plug' },
  { key: 'settings', label: 'הגדרות', icon: 'gear' },
];
const MOBILE: NavItem[] = [
  { key: 'today', label: 'היום', icon: 'sun' },
  { key: 'community', label: 'הקהילה', icon: 'map' },
  { key: 'messages', label: 'הודעות', icon: 'chat' },
  { key: 'activity', label: 'פעילות', icon: 'tasks' },
  { key: 'more', label: 'עוד', icon: 'gear' },
];
/** בטלפון: איזו לשונית תחתונה מסומנת לכל מסך */
const MOBILE_OF: Partial<Record<View, View>> = { tasks: 'activity', events: 'activity', donations: 'activity', connections: 'more', settings: 'more' };

const SYNC_MS = 5 * 60_000;

export function App() {
  const { db, status, sync, syncError, load, login, syncNow, startLocal } = useStore();
  const [{ view, tab }, setRoute] = useState(parseHash);
  const { family, openFamily, setPalette } = useNav();
  const toast = useToast((s) => s.show);

  useEffect(() => { void load(); }, [load]);
  const accent = db?.__SETTINGS__?.webAccent as string | undefined;
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // סנכרון קבוע: כל 5 דקות וכשחוזרים ללשונית — שינויים ממכשירים אחרים ועדכוני שטח
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void syncNow(); };
    const id = setInterval(tick, SYNC_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [syncNow]);
  useEffect(() => onFieldUpdates((n) => toast(n === 1 ? 'עדכון אחד מהשטח נקלט' : `${n} עדכונים מהשטח נקלטו`)), [toast]);

  if (status === 'loading') return null;
  if (!db) return <Welcome sync={sync} onLogin={() => void login()} onLocal={startLocal} />;

  const mission = String(db.__SETTINGS__?.missionName ?? '');
  const navBtn = (n: NavItem, sub = false) => (
    <button key={n.key} className={`nav-item${sub ? ' sub' : ''}`} aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
      <Icon name={n.icon} />{n.label}
    </button>
  );
  const isMap = view === 'community' && tab === 'map';

  return (
    <div className="app">
      <nav className="rail" aria-label="ניווט ראשי">
        <div className="brand">
          <div className="brand-mark">ש</div>
          <div><div className="brand-name">השליחות שלי</div>{mission && <div className="brand-sub">{mission}</div>}</div>
        </div>
        {MAIN.map((n) => navBtn(n))}
        <div className="nav-sec">פעילות</div>
        {ACTIVITY.map((n) => navBtn(n, true))}
        <div className="rail-foot">{FOOT.map((n) => navBtn(n))}</div>
      </nav>

      <main className={`main${isMap ? ' main-map' : ''}`}>
        <div className="topbar">
          <button className="search search-trigger" onClick={() => setPalette(true)} aria-label="חיפוש ופקודות (Ctrl+K)">
            <Icon name="search" size={17} /><span className="ph">חיפוש משפחה, כתובת, טלפון או פקודה</span><span className="kbd">Ctrl K</span>
          </button>
          <SyncBadge sync={sync} error={syncError} onLogin={() => void login()} onSync={() => void syncNow(true)} />
        </div>
        {view === 'today' && <Home db={db} onNavigate={(v) => (v === 'map' ? go('community', 'map') : go(v as View))} />}
        {view === 'community' && <CommunityShell db={db} tab={tab as CommunityTab} />}
        {view === 'messages' && <Messages db={db} />}
        {view === 'tasks' && <Tasks db={db} />}
        {view === 'events' && <Events db={db} />}
        {view === 'donations' && <Donations db={db} />}
        {view === 'connections' && <Connections db={db} />}
        {view === 'settings' && <Settings db={db} />}
        {view === 'activity' && <ActivityHub db={db} />}
        {view === 'more' && <More db={db} />}
      </main>

      <nav className="tabbar" aria-label="ניווט">
        {MOBILE.map((n) => (
          <button key={n.key} aria-current={(MOBILE_OF[view] ?? view) === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <Icon name={n.icon} size={22} />{n.label}
          </button>
        ))}
      </nav>

      {family && getBuilding(db, family.bldg)?.apts[family.idx] && !getBuilding(db, family.bldg)!.apts[family.idx]!.deletedAt && (
        <FamilyCard db={db} fref={family} onClose={() => openFamily(null)} onMoved={openFamily} />
      )}
      <Palette db={db} />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

function SyncBadge({ sync, error, onLogin, onSync }: { sync: string; error: string | null; onLogin: () => void; onSync: () => void }) {
  const lastSync = useStore((s) => s.lastSync);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(id); }, []);
  if (sync === 'auth-needed') return <button className="sync warn" onClick={onLogin}><Icon name="cloud" size={16} />התחברות לגוגל</button>;
  if (sync === 'error') return <button className="sync err sync-btn" title={error ?? ''} onClick={onSync}><Icon name="cloud" size={16} />{error ?? 'שגיאת סנכרון'} · לנסות שוב</button>;
  if (sync === 'syncing') return <span className="sync"><Icon name="cloud" size={16} />מסנכרן…</span>;
  if (sync === 'offline') return <span className="sync" title="הנתונים נשמרים במכשיר בלבד"><Icon name="cloud" size={16} />מצב מקומי</span>;
  const mins = lastSync ? Math.floor((Date.now() - lastSync) / 60000) : null;
  return (
    <button className="sync sync-btn" onClick={onSync} title="לחיצה: סנכרון עכשיו">
      <Icon name="cloud" size={16} />מסונכרן{mins !== null ? (mins < 1 ? ' · עכשיו' : ` · לפני ${mins} דק׳`) : ''}
    </button>
  );
}

function Welcome({ sync, onLogin, onLocal }: { sync: string; onLogin: () => void; onLocal: () => void }) {
  return (
    <main className="main">
      <section className="panel welcome">
        <div className="brand-mark" style={{ margin: '0 auto 16px', width: 48, height: 48, fontSize: 22 }}>ש</div>
        <h1>ברוכים הבאים להשליחות שלי</h1>
        <p>המערכת שומרת את נתוני הקהילה בגוגל דרייב שלך, כך שהם תמיד שלך. התחבר כדי לטעון את הקהילה או להתחיל קהילה חדשה.</p>
        <button className="btn btn-primary" onClick={onLogin}>{sync === 'syncing' ? 'מתחבר…' : 'התחברות עם Google'}</button>
        <p className="sheet-hint" style={{ marginTop: 16 }}><button className="link" onClick={onLocal}>להמשיך בלי חשבון</button>. הנתונים יישמרו רק במכשיר הזה.</p>
      </section>
    </main>
  );
}
