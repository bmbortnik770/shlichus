import { useMemo, useState } from 'react';
import {
  type Apartment, type Db, type Occasion, type TodayItem,
  computeToday, getBuilding, hebrewDateLine, isConnectorActive, listTasks, parseLooseDate, setTaskDone, taskGroup, upcomingOccasions,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useNav } from '../nav';
import { Dialog, useCopy, useToast } from '../ui';

type Filter = 'all' | 'urgent' | 'dates' | 'lost';
const DATE_KINDS = new Set(['yahrzeit', 'birthday', 'anniversary', 'barmitzva', 'occasion']);

function initials(name: string): string {
  const clean = name.replace(/^משפחת\s+/, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : clean.slice(0, 2);
}

function phoneOf(a: Apartment): string {
  return String(a.fatherPhone || a.motherPhone || a.phones || '').split(/[,;]/)[0]!.trim();
}

/** 050-1234567 → 972501234567 */
function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

/** כמה קשרים תועדו מיום ראשון האחרון */
function contactsThisWeek(db: Db, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  let n = 0;
  for (const [k, v] of Object.entries(db)) {
    const b = getBuilding(db, k);
    if (!b || !v) continue;
    for (const a of b.apts) {
      if (a.deletedAt) continue;
      for (const l of a.interactions ?? []) {
        const d = parseLooseDate(l.date);
        if (d && d >= start && d <= now) n++;
      }
    }
  }
  return n;
}

const NUM_WORDS = ['', 'אחת', 'שתי', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר'];

/** "יארצייט ושתי משפחות שהתרחקו" */
function describeUrgent(items: TodayItem[]): string {
  const parts: string[] = [];
  const dated = items.filter((i) => i.reasons[0]!.kind !== 'lost');
  for (const i of dated.slice(0, 2)) {
    const r = i.reasons[0]!;
    parts.push(r.inDays === 0 ? `${r.label} היום אצל ${i.name}` : `${r.label} אצל ${i.name}`);
  }
  const lost = items.length - dated.length;
  if (lost === 1) parts.push('משפחה אחת שהתרחקה');
  else if (lost > 1) parts.push(`${NUM_WORDS[lost] ?? lost} משפחות שהתרחקו`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ו${parts.at(-1)}` : parts[0] ?? '';
}

function dotKind(item: TodayItem): string {
  const s = item.daysSinceContact;
  if (s === null) return 'var(--cold)';
  if (s <= 30) return 'var(--ok)';
  if (s <= 90) return 'var(--cool)';
  if (s <= 180) return 'var(--warm)';
  return 'var(--hot)';
}

export function Home({ db, onNavigate }: { db: Db; onNavigate: (v: string) => void }) {
  const logContact = useStore((s) => s.logContact);
  const showToast = useToast((s) => s.show);
  const now = useMemo(() => new Date(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [done, setDone] = useState<Map<string, () => void>>(new Map());
  const [msg, setMsg] = useState<Occasion | null>(null);

  // הרשימה נקבעת פעם אחת לפתיחת המסך, כדי שמי שסימנת לא "יקפוץ" החוצה
  const [today] = useState(() => computeToday(db, { now }));
  const settings = db.__SETTINGS__;
  const occasions = useMemo(() => (isConnectorActive(settings, 'hebcal') ? upcomingOccasions(now, 7) : []), [now, settings]);
  const todayOcc = occasions.find((o) => o.inDays === 0 || (o.inDays === 1 && o.occasions.some((x) => x.kind === 'rosh-chodesh')));
  const moment = todayOcc?.occasions.find((o) => o.message);

  const weekGoal = Number(settings?.weeklyGoal) || 20;
  const weekDone = useMemo(() => contactsThisWeek(db, now), [db, now]);

  const key = (i: TodayItem) => `${i.bldg}|${i.idx}`;
  const left = today.items.filter((i) => !done.has(key(i)));
  const urgent = left.filter((i) => i.urgent);
  const shown = today.items.filter((i) =>
    filter === 'all' ? true
      : filter === 'urgent' ? i.urgent
      : filter === 'dates' ? i.reasons.some((r) => DATE_KINDS.has(r.kind))
      : i.reasons.some((r) => r.kind === 'lost'));

  const toggleDone = (item: TodayItem) => {
    const k = key(item);
    const forget = () => setDone((m) => { const n = new Map(m); n.delete(k); return n; });
    const undo = done.get(k);
    if (undo) { undo(); forget(); return; }
    const u = logContact(item.bldg, item.idx, 'phone');
    setDone((m) => new Map(m).set(k, u));
    showToast(`נרשם קשר עם ${item.name}`, () => { u(); forget(); });
  };

  const week = useMemo(() => {
    const rows = today.upcoming.map((u) => ({ inDays: u.inDays, date: u.date, hebrew: u.hebrew, kind: u.kind as string, title: u.title }));
    const seen = new Set<string>();
    for (const d of occasions) for (const o of d.occasions) {
      if (seen.has(o.title)) continue; // ראש חודש של יומיים — שורה אחת
      seen.add(o.title);
      rows.push({ inDays: d.inDays, date: d.date, hebrew: d.hebrew, kind: o.kind, title: o.title });
    }
    return rows.sort((a, b) => a.inDays - b.inDays).slice(0, 8);
  }, [today, occasions]);

  const p = today.pulse;
  const lede = left.length === 0
    ? 'סיימת את כל מה שתוכנן להיום. כל הכבוד.'
    : urgent.length
      ? <>התחל מ־<b>{urgent.length === 1 ? 'הדחוף' : `${urgent.length} הדחופים`}</b>: {describeUrgent(urgent)}.</>
      : 'אין משהו דחוף. זה זמן טוב לחזק קשר עם משפחות שהתרחקו.';

  return (
    <>
      <section className="hello">
        <div>
          <div className="eyebrow">
            <span>{hebrewDateLine(now)}</span>
            {occasions.filter((o) => o.inDays === 0).flatMap((o) => o.occasions).map((o) => <span className="occ" key={o.title}>{o.title}</span>)}
          </div>
          <h1>{left.length ? <>בוקר טוב. <span className="num">{left.length}</span> {left.length === 1 ? 'אדם מחכה' : 'אנשים מחכים'} לך היום.</> : 'בוקר טוב.'}</h1>
          <p className="lede">{lede}</p>
        </div>
        <div className="week-goal">
          <div className="lbl"><span>יעד קשרים לשבוע</span><b className="num">{weekDone} / {weekGoal}</b></div>
          <div className="bar"><i style={{ width: `${Math.min(100, (weekDone / weekGoal) * 100)}%` }} /></div>
        </div>
      </section>

      <div className="grid">
        <div>
          {moment && (
            <div className="moment">
              <div className="ic"><Icon name="moon" size={20} /></div>
              <div className="tx"><b>{moment.title}</b><span>{moment.suggestion}</span></div>
              <button className="btn" onClick={() => setMsg(moment)}>לצפייה בהודעה</button>
            </div>
          )}

          <section className="panel" aria-labelledby="todayH">
            <div className="panel-head">
              <h2 id="todayH">להתקשר היום<span className="num">{shown.length}</span></h2>
              <div className="filters" role="group" aria-label="סינון">
                {([['all', 'הכל'], ['urgent', 'דחוף'], ['dates', 'תאריכים'], ['lost', 'התרחקו']] as const).map(([f, l]) => (
                  <button key={f} className="chip-f" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>
                ))}
              </div>
            </div>
            <ul className="people">
              {shown.length === 0 && <li className="empty">{today.items.length ? 'אין אנשים בסינון הזה היום.' : 'אין היום אף אחד שדורש תשומת לב מיוחדת.'}</li>}
              {shown.map((item) => {
                const apt = getBuilding(db, item.bldg)?.apts[item.idx];
                const phone = apt ? phoneOf(apt) : '';
                const r0 = item.reasons[0]!;
                const isDone = done.has(key(item));
                return (
                  <li key={key(item)} className={`person k-${r0.kind}${isDone ? ' done' : ''}`}>
                    <div className="av" style={{ ['--dot' as string]: dotKind(item) }}>{initials(item.name)}</div>
                    <div className="who">
                      <div><button className="link nm-link" onClick={() => useNav.getState().openFamily({ bldg: item.bldg, idx: item.idx })}>{item.name}</button><span className="meta">{item.address}{item.daysSinceContact !== null ? ` · קשר אחרון לפני ${item.daysSinceContact} ימים` : ''}</span></div>
                      {item.reasons.map((r) => (
                        <div className={`why k-${r.kind}`} key={r.kind + r.detail}><span className="tag">{r.label}</span><span>{r.detail}</span></div>
                      ))}
                    </div>
                    <div className="acts">
                      <a className="ib" href={phone ? `https://wa.me/${waNumber(phone)}` : undefined} target="_blank" rel="noreferrer"
                        aria-disabled={!phone} title={phone ? `WhatsApp ${phone}` : 'אין מספר טלפון'} aria-label={`WhatsApp ל${item.name}`}><Icon name="wa" size={17} /></a>
                      <a className="ib" href={phone ? `tel:${phone}` : undefined} aria-disabled={!phone}
                        title={phone || 'אין מספר טלפון'} aria-label={`שיחה ל${item.name}`}><Icon name="phone" size={17} /></a>
                      <button className="ib check" aria-pressed={isDone} onClick={() => toggleDone(item)}
                        title="סמן שדיברנו" aria-label={`סמן שדיברנו עם ${item.name}`}><Icon name="done" size={17} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="side">
          <TodayTasks db={db} onAll={() => onNavigate('tasks')} />
          <section className="panel">
            <h3>השבוע הקרוב</h3>
            {week.length === 0 ? <p className="lede" style={{ fontSize: 14 }}>אין תאריכים מיוחדים השבוע.</p> : (
              <ul className="days">
                {week.map((w, i) => {
                  const [d, m] = w.hebrew.split(' ');
                  const weekday = w.inDays === 0 ? 'היום' : w.inDays === 1 ? 'מחר' : `יום ${new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(w.date).replace('יום ', '')}`;
                  return (
                    <li className={`day k-${w.kind}`} key={i}>
                      <div className="dbox"><b>{d}</b><span>{m}</span></div>
                      <div><div className="t"><span className="dot" />{w.title}</div>
                        <div className="s">{weekday} · {w.date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</div></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3>הקשר עם הקהילה</h3>
            <div className="pulse-bar" aria-hidden="true">
              <i style={{ flex: p.month, background: 'var(--ok)' }} />
              <i style={{ flex: p.quarter, background: 'var(--cool)' }} />
              <i style={{ flex: p.half, background: 'var(--warm)' }} />
              <i style={{ flex: p.older, background: 'var(--hot)' }} />
              <i style={{ flex: p.never, background: 'var(--cold)' }} />
            </div>
            <div className="legend num">
              <span><span className="dot" style={{ background: 'var(--ok)' }} />בקשר החודש<b>{p.month}</b></span>
              <span><span className="dot" style={{ background: 'var(--cool)' }} />עד 3 חודשים<b>{p.quarter}</b></span>
              <span><span className="dot" style={{ background: 'var(--warm)' }} />3–6 חודשים<b>{p.half}</b></span>
              <span><span className="dot" style={{ background: 'var(--hot)' }} />מעל חצי שנה<b>{p.older}</b></span>
              <span><span className="dot" style={{ background: 'var(--cold)' }} />עוד לא הכרנו<b>{p.never}</b></span>
            </div>
          </section>

          {!isConnectorActive(settings, 'google-calendar') && (
            <section className="panel connect">
              <div className="gi"><Icon name="cal" size={19} /></div>
              <div>
                <b>יומן Google</b> <span className="badge badge-free">חינם</span>
                <p>ימי הולדת, יארצייטים ואירועים יופיעו ביומן שלך, בתאריך העברי הנכון בכל שנה.</p>
                <button className="btn" onClick={() => onNavigate('connections')}>לחיבורים</button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {msg && <MessageDialog occasion={msg} families={p.total} waPro={isConnectorActive(settings, 'wa-cloud')} onClose={() => setMsg(null)} />}
    </>
  );
}

function MessageDialog({ occasion, families, waPro, onClose }: { occasion: Occasion; families: number; waPro: boolean; onClose: () => void }) {
  const [text, setText] = useState(occasion.message ?? '');
  const { copied, copy } = useCopy();
  return (
    <Dialog title={occasion.title} onClose={onClose}>
      <label className="field" htmlFor="occMsg">ההודעה
        <textarea id="occMsg" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="note">
        {waPro
          ? `ההודעה תישלח ל־${families} משפחות דרך WhatsApp העסקי.`
          : <>שליחה אוטומטית לכל {families} המשפחות זמינה עם חיבור WhatsApp עסקי (חבילת Pro). בינתיים אפשר להעתיק ולהדביק ברשימת תפוצה או בקבוצת הקהילה.</>}
      </div>
      <div className="dialog-acts">
        <button className="btn" onClick={onClose}>סגירה</button>
        <button className="btn btn-primary" onClick={() => void copy(text)}><Icon name="copy" size={16} />{copied ? 'הועתק' : 'העתקת ההודעה'}</button>
      </div>
    </Dialog>
  );
}

/** משימות שבאיחור ולהיום — סימון ביצוע ישירות מכאן (כמו בלוח הבקרה הקודם) */
function TodayTasks({ db, onAll }: { db: Db; onAll: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const showToast = useToast((s) => s.show);
  const list = useMemo(() => listTasks(db).filter((t) => ['overdue', 'today'].includes(taskGroup(t))), [db]);
  if (!list.length) return null;
  return (
    <section className="panel today-tasks">
      <h3>משימות להיום <span className="num">{list.length}</span></h3>
      <ul>
        {list.slice(0, 6).map((t) => (
          <li key={t.id} className={taskGroup(t) === 'overdue' ? 'late' : ''}>
            <button className="tcheck" aria-label="סימון כבוצעה" onClick={() => { const undo = mutate((d) => setTaskDone(d, t, true)); showToast('המשימה סומנה כבוצעה', undo); }}><Icon name="done" size={13} /></button>
            <span className="tt">{t.text}{t.family && <span className="meta"> · {t.family.name}</span>}</span>
          </li>
        ))}
      </ul>
      <button className="link" onClick={onAll}>{list.length > 6 ? `עוד ${list.length - 6} משימות` : 'לכל המשימות'}</button>
    </section>
  );
}
