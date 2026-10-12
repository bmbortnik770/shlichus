import { useMemo, useState } from 'react';
import {
  type CommunityEvent, type Db, type FamilyRef, addRegistrant, createEvent, displayName, familyPhones, formatHebrew,
  getBuilding, hebrewDateLine, hebrewParts, listEvents, listFamilies, nextOccurrence, parseLooseDate, toggleAttendance,
  upcomingOccasions, updateEvent,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import '../community.css';
import '../events.css';

type Kind = 'yahrzeit' | 'birthday' | 'anniversary' | 'barmitzva' | 'other' | 'holiday' | 'event';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'event', label: 'אירועי קהילה' }, { key: 'holiday', label: 'חגים ומועדים' }, { key: 'yahrzeit', label: 'יארצייטים' },
  { key: 'birthday', label: 'ימי הולדת' }, { key: 'anniversary', label: 'ימי נישואין' }, { key: 'barmitzva', label: 'בר/בת מצווה' }, { key: 'other', label: 'אחר' },
];
interface CalItem { date: Date; inDays: number; kind: Kind; title: string; family?: FamilyRef & { name: string }; eventId?: string }

const DAY = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const daysFrom = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
const gregShort = (d: Date) => d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const relDay = (n: number) => (n === 0 ? 'היום' : n === 1 ? 'מחר' : n < 7 ? `בעוד ${n} ימים` : n < 14 ? 'בשבוע הבא' : `בעוד ${n} ימים`);
const hebOf = (d: Date) => { const h = hebrewParts(d); return h ? formatHebrew(h.day, h.monthName) : ''; };

export function Events({ db }: { db: Db }) {
  const [range, setRange] = useState(30);
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(KINDS.map((k) => k.key)));
  const [openFam, setOpenFam] = useState<FamilyRef | null>(null);
  const [openEv, setOpenEv] = useState<string | 'new' | null>(null);
  const [showPast, setShowPast] = useState(false);
  const now = new Date();

  const events = useMemo(() => listEvents(db), [db]);
  const upcomingEv = events.filter((e) => { const d = parseLooseDate(e.date); return !d || daysFrom(now, d) >= 0; }).reverse();
  const pastEv = events.filter((e) => { const d = parseLooseDate(e.date); return d && daysFrom(now, d) < 0; });

  const items = useMemo(() => {
    const out: CalItem[] = [];
    for (const r of listFamilies(db)) {
      const name = displayName(r.apt) || r.bldg;
      for (const m of r.apt.milestones ?? []) {
        if (!m.day || !m.monthName) continue;
        const next = nextOccurrence(String(m.monthName), Number(m.day), now);
        if (!next) continue;
        const inDays = daysFrom(now, next);
        if (inDays > range) continue;
        // אבן דרך חד-פעמית שתאריכה עבר — לא חוזרת
        if (m.recurring === false && m.gregDate && daysFrom(now, new Date(`${m.gregDate}T12:00:00`)) < 0) continue;
        const kind = (['yahrzeit', 'birthday', 'anniversary', 'barmitzva'].includes(String(m.type)) ? m.type : 'other') as Kind;
        out.push({ date: next, inDays, kind, title: String(m.label ?? ''), family: { bldg: r.bldg, idx: r.idx, name } });
      }
    }
    for (const day of upcomingOccasions(now, range)) {
      for (const o of day.occasions) out.push({ date: day.date, inDays: day.inDays, kind: 'holiday', title: o.title });
    }
    for (const e of events) {
      const d = parseLooseDate(e.date);
      if (!d) continue;
      const inDays = daysFrom(now, d);
      if (inDays < 0 || inDays > range) continue;
      out.push({ date: d, inDays, kind: 'event', title: `${e.name}${e.time ? ` · ${e.time}` : ''}`, eventId: e.id });
    }
    return out.sort((a, b) => a.inDays - b.inDays || a.kind.localeCompare(b.kind));
  }, [db, range, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = items.filter((i) => kinds.has(i.kind));
  const byDay = new Map<number, CalItem[]>();
  for (const i of shown) byDay.set(i.inDays, [...(byDay.get(i.inDays) ?? []), i]);
  const counts = (k: Kind) => items.filter((i) => i.kind === k).length;

  return (
    <>
      <section className="hello">
        <div>
          <p className="eyebrow">{hebrewDateLine(now)}</p>
          <h1>אירועים</h1>
          <p className="lede">אירועי הקהילה, החגים, והתאריכים של המשפחות. הכל בלוח אחד.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpenEv('new')}><Icon name="plus" size={16} />אירוע חדש</button>
      </section>

      <section className="ev-strip" aria-label="אירועי קהילה קרובים">
        {upcomingEv.length === 0 && <div className="panel ev-empty">אין אירועים קרובים. <button className="link" onClick={() => setOpenEv('new')}>ליצור אירוע</button></div>}
        {upcomingEv.map((e) => <EventCard key={e.id} e={e} now={now} onOpen={() => setOpenEv(e.id)} />)}
      </section>
      {pastEv.length > 0 && (
        <>
          <button className="link" onClick={() => setShowPast(!showPast)}>{showPast ? 'הסתרת אירועים שעברו' : `${pastEv.length} אירועים שעברו`}</button>
          {showPast && <section className="ev-strip past">{pastEv.map((e) => <EventCard key={e.id} e={e} now={now} onOpen={() => setOpenEv(e.id)} />)}</section>}
        </>
      )}

      <section className="panel cal">
        <div className="cal-head">
          <h2>הלוח הקרוב</h2>
          <select className="sel" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="טווח">
            <option value={14}>שבועיים</option><option value={30}>חודש</option><option value={90}>3 חודשים</option><option value={365}>שנה</option>
          </select>
        </div>
        <div className="chips cal-kinds">
          {KINDS.map((k) => (
            <button key={k.key} className={`chip-f k-${k.key}`} aria-pressed={kinds.has(k.key)}
              onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k.key)) n.delete(k.key); else n.add(k.key); return n; })}>
              {k.label} <span className="num">{counts(k.key)}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? <p className="muted">אין תאריכים בטווח הזה.</p> : (
          <ol className="cal-days">
            {[...byDay.entries()].map(([n, list]) => (
              <li key={n}>
                <div className="cal-date"><b>{relDay(n)}</b><span>{gregShort(list[0]!.date)}</span><span className="heb">{hebOf(list[0]!.date)}</span></div>
                <ul>
                  {list.map((i, j) => (
                    <li key={j} className={`k-${i.kind}`}>
                      <i className="kdot" />
                      <span className="t">{i.title}</span>
                      {i.family && <button className="chip-f" onClick={() => setOpenFam(i.family!)}>{i.family.name}</button>}
                      {i.eventId && <button className="chip-f" onClick={() => setOpenEv(i.eventId!)}>פרטים</button>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {openEv && <EventDialog db={db} id={openEv} onClose={() => setOpenEv(null)} onCreated={setOpenEv} />}
      {openFam && getBuilding(db, openFam.bldg)?.apts[openFam.idx] && <FamilyCard db={db} fref={openFam} onClose={() => setOpenFam(null)} onMoved={setOpenFam} />}
    </>
  );
}

function EventCard({ e, now, onOpen }: { e: CommunityEvent; now: Date; onOpen: () => void }) {
  const d = parseLooseDate(e.date);
  const n = d ? daysFrom(now, d) : null;
  return (
    <button className="panel ev-card" onClick={onOpen}>
      <span className="ev-when">{d ? (n !== null && n >= 0 ? relDay(n) : d.toLocaleDateString('he-IL')) : 'בלי תאריך'}{e.time ? ` · ${e.time}` : ''}</span>
      <b>{e.name}</b>
      {d && <span className="meta">{hebOf(d)}{e.location ? ` · ${e.location}` : ''}</span>}
      <span className="ev-nums"><span><b className="num">{e.registrants.length}</b> נרשמו</span><span><b className="num">{e.attendance.length}</b> הגיעו</span></span>
    </button>
  );
}

function EventDialog({ db, id, onClose, onCreated }: { db: Db; id: string; onClose: () => void; onCreated: (id: string) => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const isNew = id === 'new';
  const ev = isNew ? null : listEvents(db, true).find((e) => e.id === id) ?? null;
  const [f, setF] = useState({ name: ev?.name ?? '', date: ev?.date ?? '', time: ev?.time ?? '', location: ev?.location ?? '', notes: ev?.notes ?? '' });
  const [who, setWho] = useState('');
  const families = useMemo(() => listFamilies(db).map((r) => ({ name: displayName(r.apt), phone: familyPhones(r.apt)[0] ?? '', ref: `${r.bldg}|${r.idx}` })).filter((x) => x.name), [db]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = () => {
    if (!f.name.trim()) return;
    if (isNew) {
      let nid = '';
      const undo = mutate((d) => { nid = createEvent(d, { ...f, name: f.name.trim(), type: 'אירוע' }); });
      toast(`האירוע "${f.name.trim()}" נוצר`, undo);
      onCreated(nid);
      return;
    }
    const undo = mutate((d) => updateEvent(d, id, { ...f, name: f.name.trim() }));
    toast('האירוע עודכן', undo);
  };
  const register = () => {
    const name = who.trim();
    if (!name || !ev) return;
    const fam = families.find((x) => x.name === name);
    mutate((d) => addRegistrant(d, id, { name, phone: fam?.phone ?? '', famRef: fam?.ref ?? null }));
    setWho('');
  };

  return (
    <Dialog title={isNew ? 'אירוע חדש' : ev?.name ?? 'אירוע'} onClose={onClose}>
      <form className="ev-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="fld"><span>שם האירוע</span><input value={f.name} onChange={set('name')} placeholder="למשל: התוועדות י״ט כסלו" /></label>
        <div className="ev-row">
          <label className="fld"><span>תאריך</span><input type="date" value={f.date} onChange={set('date')} /></label>
          <label className="fld"><span>שעה</span><input type="time" value={f.time} onChange={set('time')} /></label>
        </div>
        {f.date && <p className="dialog-note">{hebrewDateLine(new Date(`${f.date}T12:00:00`))}</p>}
        <label className="fld"><span>מקום</span><input value={f.location} onChange={set('location')} /></label>
        <label className="fld"><span>הערות</span><textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
        <div className="dialog-acts">
          {!isNew && <button type="button" className="btn btn-ghost-danger" onClick={() => void (async () => {
            if (!(await ask({ title: 'ביטול אירוע', message: `לבטל את "${ev?.name}"? הוא יוסתר מהלוח.`, confirm: 'ביטול האירוע', danger: true }))) return;
            const undo = mutate((d) => updateEvent(d, id, { cancelled: true }));
            toast('האירוע בוטל', undo); onClose();
          })()}>ביטול האירוע</button>}
          <button type="submit" className="btn btn-primary" disabled={!f.name.trim()}>{isNew ? 'יצירה' : 'שמירה'}</button>
        </div>
      </form>

      {ev && (
        <section className="ev-regs">
          <h3>נרשמים <span className="num">{ev.registrants.length}</span> · הגיעו <span className="num">{ev.attendance.length}</span></h3>
          <form className="fc-add" onSubmit={(e) => { e.preventDefault(); register(); }}>
            <input list="ev-fams" value={who} onChange={(e) => setWho(e.target.value)} placeholder="משפחה או שם" aria-label="רישום לאירוע" />
            <datalist id="ev-fams">{families.filter((x) => !ev.registrants.some((r) => r.name === x.name)).map((x, i) => <option key={i} value={x.name} />)}</datalist>
            <button className="btn" disabled={!who.trim()}>רישום</button>
          </form>
          <ul className="fc-list">
            {ev.registrants.map((r) => (
              <li key={r.name}>
                <label className="chk-row"><input type="checkbox" checked={ev.attendance.includes(r.name)} onChange={() => mutate((d) => toggleAttendance(d, id, r.name))} />{r.name}</label>
                {r.phone && <span className="meta" dir="ltr">{r.phone}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
