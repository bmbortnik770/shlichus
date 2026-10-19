import { useMemo } from 'react';
import {
  type Db, displayName, donorSummaries, listDonations, listEvents, listTasks, parseLooseDate, taskGroup,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { type CommunityTab, go, useNav } from '../nav';
import { type ThemeMode, getThemeMode, setThemeMode } from '../themeMode';
import { applyAccent } from '../accent';
import { MapView } from './MapView';
import { Community } from './Community';
import { Circles } from './Messages';
import '../shell.css';

/** הקהילה: נפתחת על המפה (לוח התוצאות של השליחות), ומשם לאנשים ולמעגלים */
export function CommunityShell({ db, tab }: { db: Db; tab: CommunityTab }) {
  const openFamily = useNav((s) => s.openFamily);
  const tabs: { key: CommunityTab; label: string }[] = [{ key: 'map', label: 'מפה' }, { key: 'people', label: 'אנשים' }, { key: 'circles', label: 'מעגלים' }];
  const switcher = (
    <div className="seg com-switch" role="tablist" aria-label="תצוגת הקהילה">
      {tabs.map((t) => <button key={t.key} role="tab" aria-pressed={tab === t.key} onClick={() => go('community', t.key)}>{t.label}</button>)}
    </div>
  );
  if (tab === 'map') return <MapView db={db} switcher={switcher} />;
  return (
    <>
      <div className="com-top">{switcher}</div>
      {tab === 'people' ? <Community db={db} /> : (
        <>
          <section className="hello"><div><h1>מעגלים</h1><p className="lede">קבוצות של משפחות לשליחה ולמעקב, למשל שיעור או מניין.</p></div></section>
          <Circles db={db} onOpen={openFamily} />
        </>
      )}
    </>
  );
}

/** פעילות (בטלפון): משימות, אירועים ותרומות במבט אחד */
export function ActivityHub({ db }: { db: Db }) {
  const now = new Date();
  const tasks = useMemo(() => listTasks(db), [db]);
  const overdue = tasks.filter((t) => taskGroup(t, now) === 'overdue').length;
  const today = tasks.filter((t) => taskGroup(t, now) === 'today').length;
  const nextEv = useMemo(() => listEvents(db).map((e) => ({ e, d: parseLooseDate(e.date) })).filter((x) => x.d && x.d.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()).sort((a, b) => a.d!.getTime() - b.d!.getTime())[0], [db]); // eslint-disable-line react-hooks/exhaustive-deps
  const thanks = useMemo(() => donorSummaries(db).filter((d) => d.needsThanks).length, [db]);
  const month = useMemo(() => listDonations(db).filter((r) => r.date && r.date.getMonth() === now.getMonth() && r.date.getFullYear() === now.getFullYear()).reduce((s, r) => s + r.amount, 0), [db]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <section className="hello"><div><h1>פעילות</h1></div></section>
      <div className="hub">
        <button className="panel hub-card" onClick={() => go('tasks')}>
          <span className="hub-ic"><Icon name="tasks" /></span><b>משימות ופרויקטים</b>
          <span>{overdue ? <em className="hot">{overdue} באיחור</em> : null}{today ? ` · ${today} להיום` : ''}{!overdue && !today ? 'אין משימות דחופות' : ''}</span>
        </button>
        <button className="panel hub-card" onClick={() => go('events')}>
          <span className="hub-ic"><Icon name="cal" /></span><b>אירועים</b>
          <span>{nextEv ? `הבא: ${nextEv.e.name} · ${nextEv.d!.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}` : 'אין אירוע קרוב'}</span>
        </button>
        <button className="panel hub-card" onClick={() => go('donations')}>
          <span className="hub-ic"><Icon name="heart" /></span><b>תרומות</b>
          <span>{month ? `החודש ₪${month.toLocaleString('he-IL')}` : 'אין תרומות החודש'}{thanks ? ` · ${thanks} צריכים תודה` : ''}</span>
        </button>
      </div>
    </>
  );
}

/** עוד (בטלפון): חיבורים, הגדרות, מצב תצוגה, סנכרון */
export function More({ db }: { db: Db }) {
  const { syncNow, lastSync, sync, logout } = useStore();
  const mode = getThemeMode();
  const name = String(db.__SETTINGS__?.missionName ?? '');
  const setMode = (m: ThemeMode) => { setThemeMode(m); applyAccent(db.__SETTINGS__?.webAccent as string | undefined); location.reload(); };
  return (
    <>
      <section className="hello"><div><h1>עוד</h1>{name && <p className="lede">{name}</p>}</div></section>
      <div className="hub">
        <button className="panel hub-card" onClick={() => go('connections')}><span className="hub-ic"><Icon name="plug" /></span><b>חיבורים</b><span>וואטסאפ, יומן, תרומות ועוד</span></button>
        <button className="panel hub-card" onClick={() => go('settings')}><span className="hub-ic"><Icon name="gear" /></span><b>הגדרות</b><span>תיחום, רשימות, ניקוד, ייבוא וגיבוי</span></button>
      </div>
      <section className="panel set-card more-card">
        <h2>תצוגה</h2>
        <div className="seg" role="group" aria-label="מצב תצוגה">
          {([['auto', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']] as const).map(([k, l]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        <h2>סנכרון</h2>
        <p className="sheet-hint">{sync === 'auth-needed' ? 'לא מחובר לגוגל. השינויים נשמרים במכשיר בלבד.' : lastSync ? `סונכרן לאחרונה ב-${new Date(lastSync).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : 'עוד לא סונכרן בכניסה הזו'}</p>
        <div className="fix-acts">
          <button className="btn" onClick={() => void syncNow(true)}><Icon name="cloud" size={16} />סנכרון עכשיו</button>
          {sync !== 'auth-needed' && <button className="btn btn-ghost-danger" onClick={logout}>התנתקות</button>}
        </div>
      </section>
    </>
  );
}

void displayName;
