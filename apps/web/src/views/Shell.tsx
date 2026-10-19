import { useMemo } from 'react';
import {
  type Db, displayName, donorSummaries, listDonations, listEvents, listTasks, parseLooseDate, taskGroup,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { type CommunityTab, type View, go, useNav } from '../nav';
import { type ScreenKey, SCREENS, applySuggestion, dismissSuggestion, getLayout, setLayout, suggestion } from '../navLayout';
import { useToast } from '../ui';
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

/** מסך קבוצה (בטלפון): הלשוניות של קבוצה מסידור התפריט, כל אחת עם תקציר */
export function ActivityHub({ db, groupId }: { db: Db; groupId: string }) {
  const layout = getLayout(db);
  const group = layout.groups.find((g) => g.id === groupId) ?? layout.groups.find((g) => g.id === 'activity');
  const now = new Date();
  const tasks = useMemo(() => listTasks(db), [db]);
  const overdue = tasks.filter((t) => taskGroup(t, now) === 'overdue').length;
  const today = tasks.filter((t) => taskGroup(t, now) === 'today').length;
  const nextEv = useMemo(() => listEvents(db).map((e) => ({ e, d: parseLooseDate(e.date) })).filter((x) => x.d && x.d.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()).sort((a, b) => a.d!.getTime() - b.d!.getTime())[0], [db]); // eslint-disable-line react-hooks/exhaustive-deps
  const thanks = useMemo(() => donorSummaries(db).filter((d) => d.needsThanks).length, [db]);
  const month = useMemo(() => listDonations(db).filter((r) => r.date && r.date.getMonth() === now.getMonth() && r.date.getFullYear() === now.getFullYear()).reduce((s, r) => s + r.amount, 0), [db]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary: Partial<Record<ScreenKey, React.ReactNode>> = {
    tasks: <>{overdue ? <em className="hot">{overdue} באיחור</em> : null}{today ? ` · ${today} להיום` : ''}{!overdue && !today ? 'אין משימות דחופות' : ''}</>,
    events: nextEv ? `הבא: ${nextEv.e.name} · ${nextEv.d!.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}` : 'אין אירוע קרוב',
    donations: <>{month ? `החודש ₪${month.toLocaleString('he-IL')}` : 'אין תרומות החודש'}{thanks ? ` · ${thanks} צריכים תודה` : ''}</>,
    connections: 'וואטסאפ, יומן, תרומות ועוד',
    settings: 'תיחום, רשימות, ניקוד, ייבוא וגיבוי',
  };
  return (
    <>
      <section className="hello"><div><h1>{group?.label || 'פעילות'}</h1></div></section>
      <div className="hub">
        {(group?.items ?? []).map((k) => (
          <button key={k} className="panel hub-card" onClick={() => go(k as View)}>
            <span className="hub-ic"><Icon name={SCREENS[k].icon} /></span><b>{SCREENS[k].label}</b>
            {summary[k] ? <span>{summary[k]}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

/** עוד (בטלפון): חיבורים, הגדרות, מצב תצוגה, סנכרון */
export function More({ db, onEditNav }: { db: Db; onEditNav: () => void }) {
  const { syncNow, lastSync, sync, logout, mutate } = useStore();
  const toast = useToast((s) => s.show);
  const layout = getLayout(db);
  const sug = suggestion(layout);
  const inBar = new Set<string>(layout.mobile.flatMap((m) => (m.startsWith('group:') ? layout.groups.find((g) => g.id === m.slice(6))?.items ?? [] : [m])));
  const mode = getThemeMode();
  const name = String(db.__SETTINGS__?.missionName ?? '');
  const setMode = (m: ThemeMode) => { setThemeMode(m); applyAccent(db.__SETTINGS__?.webAccent as string | undefined); location.reload(); };
  return (
    <>
      <section className="hello"><div><h1>עוד</h1>{name && <p className="lede">{name}</p>}</div></section>
      {sug && (
        <div className="panel ne-sug">
          <span>נכנסת ל<b>{SCREENS[sug.add].label}</b> {sug.count} פעמים. להוסיף אותו לסרגל למטה?</span>
          <button className="btn btn-s" onClick={() => { const undo = mutate((d) => setLayout(d, applySuggestion(layout, sug))); toast('הסרגל עודכן', undo); }}>הוספה</button>
          <button className="link" onClick={() => { dismissSuggestion(sug.add); toast('בסדר, לא נציע שוב'); }}>לא עכשיו</button>
        </div>
      )}
      {layout.groups.map((g) => {
        const items = g.items.filter((k) => !inBar.has(k));
        if (!items.length) return null;
        return (
          <section key={g.id} className="more-grp">
            {g.label && <h2 className="more-h">{g.label}</h2>}
            <div className="hub">
              {items.map((k) => <button key={k} className="panel hub-card" onClick={() => go(k as View)}><span className="hub-ic"><Icon name={SCREENS[k].icon} /></span><b>{SCREENS[k].label}</b></button>)}
            </div>
          </section>
        );
      })}
      <button className="btn more-edit" onClick={onEditNav}><Icon name="gear" size={16} />סידור התפריט והסרגל</button>
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
