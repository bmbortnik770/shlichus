import { useEffect, useState } from 'react';
import { getBuilding } from '@shlichus/core';
import { Icon, type IconName } from './icons';
import { onFieldUpdates, useStore } from './store';
import { ConfirmHost, ToastHost, useToast } from './ui';
import { type CommunityTab, type View, go, goHub, parseHash, useNav } from './nav';
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
import { NavEditor } from './views/NavEditor';
import { Onboarding, needsOnboarding } from './views/Onboarding';
import { QuickAdd } from './views/QuickAdd';
import { type MobileEntry, type ScreenKey, SCREENS, entryIcon, entryLabel, getLayout, mobileOwner, recordVisit } from './navLayout';
import { browserTokens, hasValidSession } from './auth';
import { applyAccent } from './accent';

/** המבנה ברירת המחדל: מה לעשות עכשיו → האנשים (על המפה) → הודעות → כלי הפעילות. כל משתמש יכול לסדר אחרת (navLayout) */
type NavItem = { key: View; label: string; icon: IconName };

const SYNC_MS = 5 * 60_000;

export function App() {
  const { db, status, sync, syncError, load, login, syncNow, startLocal } = useStore();
  const [{ view, tab, hub }, setRoute] = useState(parseHash);
  const [editNav, setEditNav] = useState(false);
  const [onboard, setOnboard] = useState(false);
  useEffect(() => { recordVisit(view); }, [view]);
  // המייל של המשתמש — כדי שסידור התפריט יישמר לכל משתמש בנפרד
  useEffect(() => {
    if (!db || !hasValidSession()) return;
    try { if (localStorage.getItem('shlichus_user_email')) return; } catch { return; }
    void browserTokens.getToken().then((t) => (t ? fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t}` } }) : null))
      .then((r) => (r && r.ok ? r.json() : null)).then((u: { email?: string } | null) => { if (u?.email) localStorage.setItem('shlichus_user_email', u.email); }).catch(() => {});
  }, [db]);
  useEffect(() => { if (db && needsOnboarding(db)) setOnboard(true); }, [!!db]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const logo = String(db.__SETTINGS__?.logo ?? '');
  const layout = getLayout(db);
  const owner = mobileOwner(layout, view, hub);
  const asItem = (k: ScreenKey): NavItem => ({ key: k, ...SCREENS[k] });
  const goEntry = (m: MobileEntry) => (m.startsWith('group:') ? goHub(m.slice(6)) : go(m as View));
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
          {logo ? <img className="brand-mark brand-logo" src={logo} alt="" /> : <div className="brand-mark">ש</div>}
          <div><div className="brand-name">השליחות שלי</div>{mission && <div className="brand-sub">{mission}</div>}</div>
        </div>
        {layout.groups.filter((g) => !g.foot).map((g) => (
          <div key={g.id} className="nav-grp">
            {g.label && g.items.length > 0 && <div className="nav-sec">{g.label}</div>}
            {g.items.map((k) => navBtn(asItem(k), !!g.label))}
          </div>
        ))}
        <div className="rail-foot">
          {layout.groups.filter((g) => g.foot).flatMap((g) => g.items).map((k) => navBtn(asItem(k)))}
          <button className="nav-item nav-edit" onClick={() => setEditNav(true)}><Icon name="gear" size={16} />סידור התפריט</button>
        </div>
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
        {view === 'activity' && <ActivityHub db={db} groupId={hub} />}
        {view === 'more' && <More db={db} onEditNav={() => setEditNav(true)} />}
      </main>

      <nav className="tabbar" aria-label="ניווט" onContextMenu={(e) => { e.preventDefault(); setEditNav(true); }}>
        {layout.mobile.map((m) => (
          <LongPress key={m} onLong={() => setEditNav(true)}>
            <button aria-current={owner === m ? 'page' : undefined} onClick={() => goEntry(m)}>
              <Icon name={entryIcon(m)} size={22} />{entryLabel(layout, m)}
            </button>
          </LongPress>
        ))}
        <LongPress onLong={() => setEditNav(true)}>
          <button aria-current={owner === 'more' ? 'page' : undefined} onClick={() => go('more')}><Icon name="gear" size={22} />עוד</button>
        </LongPress>
      </nav>
      <QuickAdd db={db} />

      {family && getBuilding(db, family.bldg)?.apts[family.idx] && !getBuilding(db, family.bldg)!.apts[family.idx]!.deletedAt && (
        <FamilyCard db={db} fref={family} onClose={() => openFamily(null)} onMoved={openFamily} />
      )}
      <Palette db={db} />
      {editNav && <NavEditor db={db} onClose={() => setEditNav(false)} />}
      {onboard && <Onboarding db={db} onClose={() => setOnboard(false)} />}
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

/** לחיצה ארוכה (בטלפון) — פותחת את סידור התפריט */
function LongPress({ onLong, children }: { onLong: () => void; children: React.ReactNode }) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const start = () => { t = setTimeout(onLong, 650); };
  const stop = () => { if (t) clearTimeout(t); };
  return <span className="lp" onTouchStart={start} onTouchEnd={stop} onTouchMove={stop} onTouchCancel={stop}>{children}</span>;
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
