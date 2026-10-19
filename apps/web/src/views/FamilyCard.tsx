import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Apartment, type Db, type FamilyRef, type InteractionLog, type Milestone, type Pledge, type Task, type LifeEvent,
  DIRECTION_LABELS, LIFE_TYPES, NO_ADDRESS_KEY, PLEDGE_STATUS,
  addDonationFull, addLifeEvent, getEventTypes, addPledge, brokenKind, buildingKeys, circleIds, circleName, dateAlerts, daysUntil, deleteFamily,
  displayName, engagementLabel, engagementScore, familyAddress, familyPhones, formatHebrew, geocodeAddress, getAptScore,
  getBuilding, getCircles, getInteractionTypes, getStatusColor, hebrewParts, hebrewYear, lastContact, lifeLabel, logTypeKey,
  makeLog, memberName, memberOptions, moveFamily, nextOccurrence, recalcPledges, removeDonation, removeLifeEvent, removePledge,
  setPledgeCancelled, splitFamily, statusSeverity, typeInfo, updateFamily, waLink,
} from '@shlichus/core';
import { Icon } from '../icons';
import { type ContactType, useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { missionCity } from '../mapData';
import { agoText } from './Community';

type Tab = 'details' | 'activity' | 'donations' | 'dates' | 'docs';
const TABS: { key: Tab; label: string }[] = [
  { key: 'details', label: 'פרטים' }, { key: 'activity', label: 'פעילות' }, { key: 'donations', label: 'תרומות' },
  { key: 'dates', label: 'חיים ומועדים' }, { key: 'docs', label: 'תיעוד' },
];
const HEB_MONTHS = ['תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר א׳', 'אדר ב׳', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול'];
const DOC_CHANNELS: Record<string, string> = { general: 'כללי', phone: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה' };
const DOC_TYPES: Record<string, string> = { summary: 'סיכום', thread: 'שרשור', transcript: 'תמליל', recording_link: 'הקלטה' };
const REASONS = ['כללי', 'צדקה', 'חג', 'אירוע', 'בניין', 'הנצחה', 'אחר'];
const SEV_CLASS = ['cold', 'ok', 'warm', 'hot'];
const SEV_TEXT = ['עוד לא היה קשר', 'בקשר', 'מתרחקים', 'צריך תשומת לב'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shekel = (n: number) => `₪${n.toLocaleString('he-IL')}`;
/** תאריך לועזי → "י״ב תמוז תשפ״ז" */
const hebOf = (iso: string | undefined) => {
  if (!iso) return '';
  const h = hebrewParts(new Date(`${String(iso).slice(0, 10)}T12:00:00`));
  return h ? `${formatHebrew(h.day, h.monthName)} ${hebrewYear(h.year)}` : '';
};

type Run = (fn: (d: Db) => void, msg?: string) => () => void;
type Ask = ReturnType<typeof useConfirm.getState>['ask'];

export function FamilyCard({ db, fref, onClose, onMoved }: { db: Db; fref: FamilyRef; onClose: () => void; onMoved: (r: FamilyRef) => void }) {
  const apt = getBuilding(db, fref.bldg)!.apts[fref.idx]!;
  const mutate = useStore((s) => s.mutate);
  const logContact = useStore((s) => s.logContact);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const [tab, setTab] = useState<Tab>('details');
  const [addrOpen, setAddrOpen] = useState(false);
  const dirtyRef = useRef(false);

  /** כל שינוי עובר דרך mutate — עם ביטול בהודעה */
  const run: Run = (fn, msg) => { const undo = mutate(fn); if (msg) toast(msg, undo); return undo; };
  const save = (patch: Partial<Apartment>, msg?: string) => { run((d) => updateFamily(d, fref, patch), msg); };

  const close = async () => {
    if (dirtyRef.current && !(await ask({ title: 'שינויים שלא נשמרו', message: 'יש בכרטיס שינויים שלא שמרת. לצאת בלי לשמור?', confirm: 'לצאת' }))) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.dialog')) void close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const phones = familyPhones(apt);
  const email = apt.fatherEmail || apt.motherEmail;
  const sev = statusSeverity(getStatusColor(apt, db.__SETTINGS__));
  const score = getAptScore(apt, db.__SETTINGS__);
  const eng = engagementScore(apt, db.__SETTINGS__);
  const deceased = (apt as { lifeStatus?: string }).lifeStatus === 'deceased';
  const name = displayName(apt) || 'משפחה חדשה';
  const initials = (apt.name || apt.father || apt.mother || '?').trim().slice(0, 2);
  const alerts = dateAlerts(apt).sort((a, b) => a.inDays - b.inDays);

  const log = (t: ContactType, label: string) => { const undo = logContact(fref.bldg, fref.idx, t); toast(`${label} נרשם`, undo); };

  const remove = async () => {
    if (!(await ask({ title: 'מחיקת משפחה', message: `למחוק את ${name}? אפשר לבטל מיד אחרי.`, confirm: 'מחיקה', danger: true }))) return;
    const undo = mutate((d) => deleteFamily(d, fref));
    toast(`${name} נמחקה`, undo);
    onClose();
  };

  const deceasedWho = (apt as { deceasedInfo?: { who?: string; name?: string } }).deceasedInfo;

  return (
    <div className="drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) void close(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={name}>
        <header className="fc-head">
          <div className={`fc-av ${SEV_CLASS[sev]}`}>{initials}</div>
          <div className="fc-id">
            <h2>{name}</h2>
            <button className="fc-addr" onClick={() => setAddrOpen(true)}>
              <Icon name="map" size={14} />
              {fref.bldg === NO_ADDRESS_KEY ? <span className="noaddr">ללא כתובת · שיבוץ כתובת</span> : familyAddress(fref.bldg, apt)}
            </button>
          </div>
          <button className="ib" onClick={() => void close()} aria-label="סגירה"><Icon name="x" size={16} /></button>
        </header>

        <div className="fc-status">
          <span className={`pill st-${SEV_CLASS[sev]}`}>{SEV_TEXT[sev]}{score >= 0 ? ` · ${score} נק׳` : ''}</span>
          <span className={`pill eng-${engagementLabel(eng).level}`} title="ציון מעורבות: פעילות אחרונה, לפי סוג ומשקל">מעורבות {eng} · {engagementLabel(eng).label}</span>
          {lastContact(apt) && <span className="pill">קשר אחרון {agoText(lastContact(apt))}</span>}
          {apt.style && <span className="pill">{apt.style}</span>}
        </div>

        {alerts.length > 0 && (
          <div className="fc-alerts">
            {alerts.map((a, i) => <span key={i} className="pill pill-accent">{a.title} · {a.inDays === 0 ? 'היום' : a.inDays === 1 ? 'מחר' : `בעוד ${a.inDays} ימים`}</span>)}
          </div>
        )}

        {deceased && (
          <div className="fc-mourn">
            לעילוי נשמת {deceasedWho?.who === 'father' ? apt.father || 'האב' : deceasedWho?.who === 'mother' ? apt.mother || 'האם' : deceasedWho?.name ?? ''} ע״ה
            <button className="link" onClick={() => save({ lifeStatus: '', deceasedInfo: undefined } as Partial<Apartment>, 'הוחזר לסטטוס פעיל')}>החזרה לסטטוס פעיל</button>
          </div>
        )}

        <div className="fc-quick">
          {phones[0] && <a className="btn" href={waLink(phones[0])} target="_blank" rel="noreferrer"><Icon name="wa" size={16} />וואטסאפ</a>}
          {phones[0] && <a className="btn" href={`tel:${phones[0]}`}><Icon name="phone" size={16} />חיוג</a>}
          {email && <a className="btn" href={`mailto:${email}`}><Icon name="chat" size={16} />מייל</a>}
          <span className="fc-log">
            רישום מהיר:
            <button className="chip-f" onClick={() => log('phone', 'שיחה')}>שיחה</button>
            <button className="chip-f" onClick={() => log('whatsapp', 'וואטסאפ')}>וואטסאפ</button>
            <button className="chip-f" onClick={() => log('visit', 'ביקור')}>ביקור</button>
          </span>
        </div>

        <nav className="fc-tabs" role="tablist">
          {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}{tabCount(apt, t.key)}</button>)}
        </nav>

        <div className="fc-body">
          {tab === 'details' && (
            <Details db={db} apt={apt} onDirty={(v) => { dirtyRef.current = v; }} onSave={(p) => { save(p, 'הפרטים נשמרו'); dirtyRef.current = false; }}
              onDeceased={(p) => save(p, 'הפטירה תועדה')}
              onSplit={(member) => { let to: FamilyRef | null = null; const undo = mutate((d) => { to = splitFamily(d, fref, member); }); toast(`נוצר כרטיס נפרד ל${member}`, undo); if (to) onMoved(to); }}
              onDelete={() => void remove()} />
          )}
          {tab === 'activity' && <Activity db={db} apt={apt} onSave={save} ask={ask} />}
          {tab === 'donations' && <Donations db={db} apt={apt} fref={fref} run={run} ask={ask} />}
          {tab === 'dates' && <Dates db={db} apt={apt} fref={fref} run={run} onSave={save} ask={ask} />}
          {tab === 'docs' && <Docs apt={apt} onSave={save} ask={ask} />}
        </div>
      </aside>

      {addrOpen && (
        <AddressDialog db={db} current={fref.bldg === NO_ADDRESS_KEY ? '' : fref.bldg} num={String(apt.num ?? '')}
          onClose={() => setAddrOpen(false)}
          onSave={(addr, num) => {
            let to: FamilyRef | null = null;
            const undo = mutate((d) => { to = moveFamily(d, fref, addr, num); });
            setAddrOpen(false);
            toast(addr ? `${name} שובצה ב${addr}` : `${name} הועברה ל"ללא כתובת"`, undo);
            if (to) onMoved(to);
          }} />
      )}
    </div>
  );
}

function tabCount(apt: Apartment, t: Tab): string {
  const n = t === 'activity' ? (apt.interactions ?? []).length : t === 'donations' ? (apt.donations ?? []).length
    : t === 'dates' ? (apt.milestones ?? []).length + ((apt.lifecycleEvents ?? []) as unknown[]).length
    : t === 'docs' ? (((apt as Record<string, unknown>).convDocs ?? []) as unknown[]).length : 0;
  return n ? ` · ${n}` : '';
}

/** בחירת בן משפחה — אותם מפתחות כמו במערכת הקיימת (family / father / mother / child:שם) */
function MemberSelect({ apt, value, onChange }: { apt: Apartment; value: string; onChange: (v: string) => void }) {
  const opts = memberOptions(apt);
  if (opts.length < 2) return null;
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="בן משפחה">{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>;
}
const MemberTag = ({ apt, m }: { apt: Apartment; m: unknown }) => {
  const n = memberName(apt, typeof m === 'string' ? m : undefined);
  return n ? <span className="pill pill-s">{n}</span> : null;
};

/* ───────── פרטים ───────── */

type Kid = { name?: string; dob?: string; gender?: string; phone?: string; email?: string };

function Details({ db, apt, onDirty, onSave, onDeceased, onSplit, onDelete }: {
  db: Db; apt: Apartment; onDirty: (v: boolean) => void; onSave: (p: Partial<Apartment>) => void;
  onDeceased: (p: Partial<Apartment>) => void; onSplit: (member: string) => void; onDelete: () => void;
}) {
  const s = db.__SETTINGS__ ?? {};
  const init = () => ({
    name: apt.name ?? '', num: String(apt.num ?? ''), father: apt.father ?? '', mother: apt.mother ?? '',
    fatherPhone: String(apt.fatherPhone ?? ''), motherPhone: String(apt.motherPhone ?? ''),
    fatherEmail: String(apt.fatherEmail ?? ''), motherEmail: String(apt.motherEmail ?? ''),
    fatherDob: String(apt.fatherDob ?? ''), motherDob: String(apt.motherDob ?? ''),
    style: apt.style ?? '', notes: String(apt.notes ?? ''),
  });
  const [f, setF] = useState(init);
  const [tags, setTags] = useState<string[]>([...(apt.tags ?? [])]);
  const [kids, setKids] = useState<Kid[]>([...((apt.childrenList ?? []) as Kid[])]);
  const [boards, setBoards] = useState<Record<string, string>>({ ...((apt.boards ?? {}) as Record<string, string>) });
  const [custom, setCustom] = useState<Record<string, unknown>>({ ...((apt.customData ?? apt.customFields ?? {}) as Record<string, unknown>) });
  const [circles, setCircles] = useState<unknown[]>([...((apt.connectionCircles ?? []) as unknown[])]);
  const [dirty, setDirty] = useState(false);
  const [dlg, setDlg] = useState<'deceased' | 'split' | null>(null);
  const touch = () => { setDirty(true); onDirty(true); };
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); touch(); };
  const setKid = (i: number, patch: Kid) => { setKids((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch(); };

  const styles = (s.styles ?? []) as string[];
  const allTags = (s.tags ?? []) as string[];
  const customFields = (s.customFields ?? []) as string[];
  const boardsList = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  const allCircles = getCircles(db);
  const inCircles = circleIds({ connectionCircles: circles } as Apartment);

  const submit = () => {
    onSave({ ...f, tags, childrenList: kids, boards, customData: custom, customFields: custom, connectionCircles: circles } as Partial<Apartment>);
    setDirty(false);
  };

  return (
    <form className="fc-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="fc-grid">
        <Fld label="שם משפחה"><input value={f.name} onChange={set('name')} /></Fld>
        <Fld label="דירה"><input value={f.num} onChange={set('num')} inputMode="numeric" /></Fld>
        <Fld label="שם האב"><input value={f.father} onChange={set('father')} /></Fld>
        <Fld label="שם האם"><input value={f.mother} onChange={set('mother')} /></Fld>
        <Fld label="טלפון האב"><input value={f.fatherPhone} onChange={set('fatherPhone')} dir="ltr" inputMode="tel" /></Fld>
        <Fld label="טלפון האם"><input value={f.motherPhone} onChange={set('motherPhone')} dir="ltr" inputMode="tel" /></Fld>
        <Fld label="מייל האב"><input value={f.fatherEmail} onChange={set('fatherEmail')} dir="ltr" inputMode="email" /></Fld>
        <Fld label="מייל האם"><input value={f.motherEmail} onChange={set('motherEmail')} dir="ltr" inputMode="email" /></Fld>
        <Fld label={`תאריך לידה — האב${f.fatherDob ? ` · ${hebOf(f.fatherDob)}` : ''}`}><input type="date" value={f.fatherDob} onChange={set('fatherDob')} /></Fld>
        <Fld label={`תאריך לידה — האם${f.motherDob ? ` · ${hebOf(f.motherDob)}` : ''}`}><input type="date" value={f.motherDob} onChange={set('motherDob')} /></Fld>
        {styles.length > 0 && (
          <Fld label="סגנון">
            <select value={f.style} onChange={set('style')}><option value="" />{styles.map((x) => <option key={x}>{x}</option>)}</select>
          </Fld>
        )}
        {customFields.map((cf) => (
          <Fld key={cf} label={cf}><input value={String(custom[cf] ?? '')} onChange={(e) => { setCustom((c) => ({ ...c, [cf]: e.target.value })); touch(); }} /></Fld>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="fc-sec">
          <h3>תגיות</h3>
          <div className="chips">
            {allTags.map((t) => (
              <button type="button" key={t} className="chip-f" aria-pressed={tags.includes(t)}
                onClick={() => { setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t])); touch(); }}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {allCircles.length > 0 && (
        <div className="fc-sec">
          <h3>מעגלים</h3>
          <div className="chips">
            {allCircles.map((c) => {
              const on = inCircles.includes(c.id);
              return (
                <button type="button" key={c.id} className="chip-f" aria-pressed={on}
                  onClick={() => {
                    setCircles((x) => (on ? x.filter((e) => (typeof e === 'string' ? e : (e as { id?: string }).id) !== c.id) : [...x, { id: c.id, member: 'family' }]));
                    touch();
                  }}>{c.emoji ? `${c.emoji} ` : ''}{circleName(c)}</button>
              );
            })}
          </div>
        </div>
      )}

      <div className="fc-sec">
        <h3>ילדים <span className="num">{kids.length || ''}</span></h3>
        {kids.map((k, i) => (
          <div className="fc-kid" key={i}>
            <input placeholder="שם" value={k.name ?? ''} onChange={(e) => setKid(i, { name: e.target.value })} aria-label="שם הילד/ה" />
            <div className="seg-s" role="group" aria-label="בן או בת">
              <button type="button" aria-pressed={k.gender === 'boy'} onClick={() => setKid(i, { gender: 'boy' })}>בן</button>
              <button type="button" aria-pressed={k.gender === 'girl'} onClick={() => setKid(i, { gender: 'girl' })}>בת</button>
            </div>
            <input type="date" value={k.dob ?? ''} onChange={(e) => setKid(i, { dob: e.target.value })} aria-label="תאריך לידה" title={hebOf(k.dob)} />
            <input placeholder="טלפון" dir="ltr" inputMode="tel" value={k.phone ?? ''} onChange={(e) => setKid(i, { phone: e.target.value })} aria-label="טלפון הילד/ה" />
            <input placeholder="מייל" dir="ltr" inputMode="email" value={k.email ?? ''} onChange={(e) => setKid(i, { email: e.target.value })} aria-label="מייל הילד/ה" />
            <button type="button" className="ib" onClick={() => { setKids((a) => a.filter((_, j) => j !== i)); touch(); }} aria-label="הסרה"><Icon name="x" size={14} /></button>
            {k.dob && <span className="meta fc-kid-heb">{hebOf(k.dob)}</span>}
          </div>
        ))}
        <button type="button" className="btn" onClick={() => { setKids((a) => [...a, { name: '', phone: '' }]); touch(); }}><Icon name="plus" size={15} />ילד/ה</button>
      </div>

      {boardsList.length > 0 && (
        <div className="fc-sec">
          <h3>לוחות פרויקטים</h3>
          <div className="chips">
            {boardsList.map((b) => (
              <button type="button" key={b.id} className="chip-f" aria-pressed={!!boards[b.id]}
                onClick={() => { setBoards((x) => { const n = { ...x }; if (n[b.id]) delete n[b.id]; else n[b.id] = b.columns[0] ?? ''; return n; }); touch(); }}>{b.name}</button>
            ))}
          </div>
        </div>
      )}

      <Fld label="הערות פנימיות"><textarea rows={3} value={f.notes} onChange={set('notes')} /></Fld>

      <div className="fc-save">
        <button className="btn btn-primary" type="submit" disabled={!dirty}>{dirty ? 'שמירת שינויים' : 'הכל שמור'}</button>
        {(apt as { lifeStatus?: string }).lifeStatus !== 'deceased' && <button type="button" className="btn" onClick={() => setDlg('deceased')}>תיעוד פטירה</button>}
        <button type="button" className="btn" onClick={() => setDlg('split')}>פיצול כרטיס</button>
        <button type="button" className="btn btn-ghost-danger" onClick={onDelete}>מחיקה</button>
      </div>

      {dlg === 'deceased' && <DeceasedDialog apt={apt} onClose={() => setDlg(null)} onSave={(p) => { onDeceased(p); setDlg(null); }} />}
      {dlg === 'split' && <SplitDialog apt={apt} kids={kids} onClose={() => setDlg(null)} onSave={(m) => { onSplit(m); setDlg(null); }} />}
    </form>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="fld"><span>{label}</span>{children}</label>;
}

function DeceasedDialog({ apt, onClose, onSave }: { apt: Apartment; onClose: () => void; onSave: (p: Partial<Apartment>) => void }) {
  const [who, setWho] = useState<'father' | 'mother' | 'other'>('father');
  const [other, setOther] = useState('');
  const [date, setDate] = useState(todayIso());
  const [yz, setYz] = useState(true);
  const submit = () => {
    const whoLabel = who === 'father' ? 'האב' : who === 'mother' ? 'האם' : other || 'ע״ה';
    const milestones = [...(apt.milestones ?? [])];
    const h = yz && date ? hebrewParts(new Date(`${date}T12:00:00`)) : null;
    if (h) milestones.push({ id: Date.now(), type: 'yahrzeit', label: `יארצייט ${whoLabel} — ${apt.name ?? ''}`, monthName: h.monthName, day: h.day, gregDate: date, recurring: true, autoCreated: true } as Milestone);
    // אותו מבנה כמו confirmDeceased במערכת הקיימת
    onSave({ lifeStatus: 'deceased', deceasedInfo: { who, name: who === 'other' ? other : undefined, date, recordedAt: new Date().toISOString() }, milestones } as Partial<Apartment>);
  };
  return (
    <Dialog title="תיעוד פטירה" onClose={onClose}>
      <Fld label="מי נפטר/ה">
        <select value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
          <option value="father">האב{apt.father ? ` · ${apt.father}` : ''}</option>
          <option value="mother">האם{apt.mother ? ` · ${apt.mother}` : ''}</option>
          <option value="other">אחר</option>
        </select>
      </Fld>
      {who === 'other' && <Fld label="שם"><input value={other} onChange={(e) => setOther(e.target.value)} /></Fld>}
      <Fld label="תאריך פטירה"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
      <label className="chk-row"><input type="checkbox" checked={yz} onChange={(e) => setYz(e.target.checked)} />להוסיף יארצייט שנתי לפי התאריך העברי</label>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" onClick={submit}>שמירה</button></div>
    </Dialog>
  );
}

function SplitDialog({ apt, kids, onClose, onSave }: { apt: Apartment; kids: { name?: string }[]; onClose: () => void; onSave: (m: string) => void }) {
  const opts = [apt.father, apt.mother, ...kids.map((k) => k.name)].filter((x): x is string => !!x && !!x.trim());
  const [pick, setPick] = useState(opts[0] ?? '__other__');
  const [other, setOther] = useState('');
  const member = pick === '__other__' ? other.trim() : pick;
  return (
    <Dialog title="פיצול כרטיס" onClose={onClose}>
      <p className="dialog-note">ייווצר כרטיס נפרד לבן/בת המשפחה, עם קישור לכרטיס הזה. למשל לילד שהתחתן ועבר דירה.</p>
      <Fld label="למי">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {opts.map((o) => <option key={o}>{o}</option>)}
          <option value="__other__">שם אחר…</option>
        </select>
      </Fld>
      {pick === '__other__' && <Fld label="שם"><input value={other} onChange={(e) => setOther(e.target.value)} /></Fld>}
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!member} onClick={() => onSave(member)}>פיצול</button></div>
    </Dialog>
  );
}

/* ───────── שיבוץ כתובת ───────── */

function AddressDialog({ db, current, num, onClose, onSave }: { db: Db; current: string; num: string; onClose: () => void; onSave: (addr: string, num: string) => void }) {
  const [addr, setAddr] = useState(current);
  const [apt, setApt] = useState(num);
  const [check, setCheck] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const known = useMemo(() => buildingKeys(db).filter((k) => k !== NO_ADDRESS_KEY && !brokenKind(k)).sort((a, b) => a.localeCompare(b, 'he', { numeric: true })), [db]);
  const a = addr.trim();
  const kind = a ? brokenKind(a) : null;
  const exists = known.includes(a);

  // כתובת חדשה — בדיקה מול הרישום הרשמי (לא חוסם, רק מתריע)
  useEffect(() => {
    if (!a || exists || kind) { setCheck('idle'); return; }
    setCheck('checking');
    const t = setTimeout(() => {
      void geocodeAddress(a, missionCity(db)).then((h) => setCheck(h ? 'found' : 'missing')).catch(() => setCheck('idle'));
    }, 600);
    return () => clearTimeout(t);
  }, [a, exists, kind, db]);

  return (
    <Dialog title="שיבוץ כתובת" onClose={onClose}>
      <Fld label="רחוב ומספר בית">
        <input list="addr-list" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="למשל: שמואל תמיר 19" />
        <datalist id="addr-list">{known.map((k) => <option key={k} value={k} />)}</datalist>
      </Fld>
      <Fld label="דירה (לא חובה)"><input value={apt} onChange={(e) => setApt(e.target.value)} inputMode="numeric" /></Fld>
      <p className={`dialog-note addr-${check}`}>
        {!a ? 'בלי כתובת המשפחה תעבור ל"ללא כתובת" ולא תופיע במפה.'
          : kind === 'nonum' ? 'בלי מספר בית המשפחה לא תסומן במפה, עד שיעודכן מספר.'
          : exists ? 'כתובת קיימת אצלך. המשפחה תופיע במפה באותו בניין.'
          : check === 'checking' ? 'בודק ברישום הכתובות הרשמי…'
          : check === 'found' ? 'הכתובת נמצאה ברישום הרשמי, והמשפחה תופיע במפה.'
          : check === 'missing' ? 'הכתובת לא נמצאה ברישום הרשמי. כדאי לבדוק את האיות ואת מספר הבית. אפשר לשמור בכל זאת.'
          : 'כתובת חדשה.'}
      </p>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" onClick={() => onSave(a, apt.trim())}>שמירה</button></div>
    </Dialog>
  );
}

/* ───────── פעילות: תיעוד, משימות, ציר זמן ───────── */

function Activity({ db, apt, onSave, ask }: { db: Db; apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void; ask: Ask }) {
  const s = db.__SETTINGS__;
  const types = getInteractionTypes(s);
  const [typeKey, setTypeKey] = useState(types.find((t) => t.key === 'call')?.key ?? types[0]?.key ?? 'other');
  const [date, setDate] = useState(todayIso());
  const [member, setMember] = useState('family');
  const [text, setText] = useState('');
  const [task, setTask] = useState('');
  const [due, setDue] = useState('');
  const [taskMember, setTaskMember] = useState('family');
  const [filter, setFilter] = useState('');
  const tasks = (apt.tasks ?? []) as Task[];
  const logs = apt.interactions ?? [];
  // הסדר בקובץ: ישנים בסוף/בהתחלה לפי המקור — כאן ממיינים לפי תאריך, עם האינדקס המקורי למחיקה
  const ordered = logs.map((l, i) => ({ l, i })).sort((a, b) => String(b.l.date ?? '').localeCompare(String(a.l.date ?? '')));
  const used = [...new Set(logs.map(logTypeKey))];
  const shown = filter ? ordered.filter((x) => logTypeKey(x.l) === filter) : ordered;
  const openTasks = tasks.map((t, i) => ({ t, i })).sort((a, b) => Number(!!a.t.done) - Number(!!b.t.done));

  const delLog = async (i: number, l: InteractionLog) => {
    if (await ask({ title: 'מחיקת תיעוד', message: `למחוק את "${typeInfo(s, logTypeKey(l)).label}" מ-${String(l.date ?? '')}?`, confirm: 'מחיקה', danger: true }))
      onSave({ interactions: logs.filter((_, j) => j !== i) }, 'התיעוד נמחק');
  };

  return (
    <>
      <form className="fc-add-col" onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSave({ interactions: [makeLog(s, { date, typeKey, text: text.trim(), member }), ...logs] }, 'התיעוד נשמר');
        setText('');
      }}>
        <div className="fc-add">
          <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} aria-label="סוג">
            {(['outgoing', 'incoming', 'milestone'] as const).map((d) => (
              <optgroup key={d} label={DIRECTION_LABELS[d]}>{types.filter((t) => t.direction === d).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>
            ))}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="תאריך" />
          <MemberSelect apt={apt} value={member} onChange={setMember} />
        </div>
        <div className="fc-add">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="מה היה? תיעוד קצר" aria-label="תיעוד" />
          <button className="btn btn-primary" disabled={!text.trim()}>תיעוד</button>
        </div>
      </form>

      <div className="fc-sec">
        <h3>משימות <span className="num">{tasks.filter((t) => !t.done).length || ''}</span></h3>
        <form className="fc-add" onSubmit={(e) => {
          e.preventDefault();
          if (!task.trim()) return;
          onSave({ tasks: [...tasks, { text: task.trim(), date: due, done: false, member: taskMember }] }, 'המשימה נוספה');
          setTask(''); setDue('');
        }}>
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="משימה חדשה" aria-label="משימה" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="תאריך יעד" />
          <MemberSelect apt={apt} value={taskMember} onChange={setTaskMember} />
          <button className="btn" disabled={!task.trim()}>הוספה</button>
        </form>
        <ul className="fc-list">
          {openTasks.map(({ t, i }) => (
            <li key={i} className={t.done ? 'done' : ''}>
              <label className="chk-row"><input type="checkbox" checked={!!t.done} onChange={() => onSave({ tasks: tasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />{String(t.text ?? '')}</label>
              <span className="fc-li-end">
                <MemberTag apt={apt} m={t.member} />
                {(t.due || t.date) ? <span className="meta">{String(t.due ?? t.date)}</span> : null}
                <button className="ib" aria-label="מחיקת משימה" onClick={() => onSave({ tasks: tasks.filter((_, j) => j !== i) }, 'המשימה נמחקה')}><Icon name="x" size={13} /></button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="fc-sec">
        <h3>ציר זמן <span className="num">{logs.length || ''}</span></h3>
        {used.length > 1 && (
          <div className="chips">
            <button className="chip-f" aria-pressed={!filter} onClick={() => setFilter('')}>הכל</button>
            {used.map((k) => <button key={k} className="chip-f" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? '' : k)}>{typeInfo(s, k).label}</button>)}
          </div>
        )}
        {shown.length === 0 ? <p className="muted">עוד אין תיעוד.</p> : (
          <ol className="timeline">
            {shown.slice(0, 100).map(({ l, i }) => {
              const t = typeInfo(s, logTypeKey(l));
              return (
                <li key={i} style={{ '--dot': t.color } as React.CSSProperties}>
                  <b>{t.label === 'אחר' && l.type ? String(l.type) : t.label}</b>
                  <span className="meta">{String(l.date ?? '')}</span>
                  <MemberTag apt={apt} m={l.member} />
                  {l.source === 'field' || l.source === 'mobile' ? <span className="pill pill-s">מהשטח</span> : null}
                  <button className="ib tl-del" aria-label="מחיקת תיעוד" onClick={() => void delLog(i, l)}><Icon name="x" size={13} /></button>
                  {(l.notes || l.text) && <p>{String(l.notes ?? l.text)}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}

/* ───────── תרומות והתחייבויות ───────── */

function Donations({ db, apt, fref, run, ask }: { db: Db; apt: Apartment; fref: FamilyRef; run: Run; ask: Ask }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [campaign, setCampaign] = useState('');
  const [reason, setReason] = useState('כללי');
  const [member, setMember] = useState('family');
  const [pledgeId, setPledgeId] = useState('');
  const [pOpen, setPOpen] = useState(false);
  const formRef = useRef<HTMLInputElement>(null);
  const campaigns = ((db.__SETTINGS__?.campaigns ?? []) as { key: string; label: string; active?: boolean }[]).filter((c) => c.active !== false);
  const dons = apt.donations ?? [];
  const list = dons.map((d, i) => ({ d, i })).reverse();
  const total = dons.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const pledges = recalcPledges(apt);
  const openPledges = pledges.filter((p) => p.status === 'pending' || p.status === 'partial');
  const pledgeOf = (id: unknown) => pledges.find((p) => p.id === id);

  const add = () => {
    const n = Number(amount);
    if (!n) return;
    run((d) => { addDonationFull(d, fref, { amount: n, date, campaign, reason, member, pledgeId: pledgeId || undefined }); },
      `נרשמה תרומה של ${shekel(n)}${n >= 500 ? ' · נוספה משימת תודה' : ''}`);
    setAmount(''); setPledgeId('');
  };
  const payFor = (p: Pledge) => {
    setPledgeId(p.id);
    setAmount(String(Math.max(0, p.amount - (p.paid ?? 0)) || ''));
    if (p.campaign) setCampaign(p.campaign);
    formRef.current?.focus();
  };

  return (
    <>
      <form className="fc-add-col" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="fc-add">
          <input ref={formRef} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="סכום ₪" inputMode="decimal" dir="ltr" aria-label="סכום" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="תאריך" />
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="סיבה">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
        </div>
        <div className="fc-add">
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="קמפיין">
            <option value="">בלי קמפיין</option>
            {campaigns.map((c) => <option key={c.key} value={c.label}>{c.label}</option>)}
          </select>
          <MemberSelect apt={apt} value={member} onChange={setMember} />
          {openPledges.length > 0 && (
            <select value={pledgeId} onChange={(e) => setPledgeId(e.target.value)} aria-label="על חשבון התחייבות">
              <option value="">לא על חשבון התחייבות</option>
              {openPledges.map((p) => <option key={p.id} value={p.id}>על חשבון {shekel(p.amount)}{p.campaign ? ` · ${p.campaign}` : ''} (נותרו {shekel(p.amount - (p.paid ?? 0))})</option>)}
            </select>
          )}
          <button className="btn btn-primary" disabled={!Number(amount)}>רישום תרומה</button>
        </div>
      </form>

      <div className="fc-total"><span>סה״כ</span><b className="num">{shekel(total)}</b><span>{dons.length} תרומות</span></div>

      <div className="fc-sec">
        <h3>התחייבויות <span className="num">{openPledges.length || ''}</span>
          <button className="link fc-h-act" onClick={() => setPOpen(true)}>+ התחייבות חדשה</button>
        </h3>
        {pledges.length === 0 ? <p className="muted">אין התחייבויות.</p> : (
          <ul className="fc-list">
            {pledges.map((p) => {
              const pct = Math.min(100, Math.round(((p.paid ?? 0) / (p.amount || 1)) * 100));
              return (
                <li key={p.id} className={`pledge st-${p.status}`}>
                  <span className="pledge-main">
                    <b className="num">{shekel(p.paid ?? 0)} / {shekel(p.amount)}</b>
                    <span className="meta">{p.campaign || 'כללי'}{p.dueDate ? ` · עד ${p.dueDate}` : ''}</span>
                    <span className="pbar"><i style={{ width: `${pct}%` }} /></span>
                  </span>
                  <span className="fc-li-end">
                    <MemberTag apt={apt} m={p.member} />
                    <span className="pill pill-s">{PLEDGE_STATUS[p.status]}</span>
                    {(p.status === 'pending' || p.status === 'partial') && <button className="btn btn-s" onClick={() => payFor(p)}>תשלום</button>}
                    <button className="link" onClick={() => run((d) => setPledgeCancelled(d, fref, p.id, p.status !== 'cancelled'), p.status === 'cancelled' ? 'ההתחייבות הוחזרה' : 'ההתחייבות בוטלה')}>{p.status === 'cancelled' ? 'החזרה' : 'ביטול'}</button>
                    <button className="ib" aria-label="מחיקת התחייבות" onClick={() => void (async () => {
                      if (await ask({ title: 'מחיקת התחייבות', message: `למחוק התחייבות של ${shekel(p.amount)}? התרומות שנרשמו עליה יישארו.`, confirm: 'מחיקה', danger: true })) run((d) => removePledge(d, fref, p.id), 'ההתחייבות נמחקה');
                    })()}><Icon name="x" size={13} /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="fc-sec">
        <h3>תרומות</h3>
        <ul className="fc-list">
          {list.map(({ d, i }) => (
            <li key={i}>
              <span><b className="num">{shekel(Number(d.amount ?? 0))}</b> <span>{d.campaign || String(d.reason ?? '') || 'כללי'}</span>
                {d.reason && d.campaign ? <span className="meta"> · {String(d.reason)}</span> : null}
                {pledgeOf(d.pledgeId) ? <span className="meta"> · על חשבון התחייבות</span> : null}</span>
              <span className="fc-li-end">
                <MemberTag apt={apt} m={d.member} />
                <span className="meta">{String(d.date ?? '')}</span>
                <button className="ib" aria-label="מחיקת תרומה" onClick={() => void (async () => {
                  if (await ask({ title: 'מחיקת תרומה', message: `למחוק תרומה של ${shekel(Number(d.amount ?? 0))} מ-${String(d.date ?? '')}?`, confirm: 'מחיקה', danger: true })) run((x) => removeDonation(x, fref, i), 'התרומה נמחקה');
                })()}><Icon name="x" size={13} /></button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {pOpen && <PledgeDialog apt={apt} campaigns={campaigns.map((c) => c.label)} onClose={() => setPOpen(false)}
        onSave={(p) => { run((d) => addPledge(d, fref, p), `נרשמה התחייבות של ${shekel(p.amount)}`); setPOpen(false); }} />}
    </>
  );
}

function PledgeDialog({ apt, campaigns, onClose, onSave }: { apt: Apartment; campaigns: string[]; onClose: () => void; onSave: (p: { amount: number; dueDate: string; campaign: string; member: string; notes: string }) => void }) {
  const [amount, setAmount] = useState('');
  const [dueDate, setDue] = useState('');
  const [campaign, setCampaign] = useState('');
  const [member, setMember] = useState('family');
  const [notes, setNotes] = useState('');
  const n = Number(amount);
  return (
    <Dialog title="התחייבות חדשה" onClose={onClose}>
      <Fld label="סכום ₪"><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" dir="ltr" /></Fld>
      <Fld label="לשלם עד (לא חובה)"><input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} /></Fld>
      <Fld label="קמפיין">
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">כללי</option>{campaigns.map((c) => <option key={c}>{c}</option>)}</select>
      </Fld>
      {memberOptions(apt).length > 1 && <Fld label="בן משפחה"><MemberSelect apt={apt} value={member} onChange={setMember} /></Fld>}
      <Fld label="הערות"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Fld>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!n} onClick={() => onSave({ amount: n, dueDate, campaign, member, notes })}>שמירה</button></div>
    </Dialog>
  );
}

/* ───────── חיים ומועדים: אירועי חיים + אבני דרך ───────── */

function Dates({ db, apt, fref, run, onSave, ask }: { db: Db; apt: Apartment; fref: FamilyRef; run: Run; onSave: (p: Partial<Apartment>, msg?: string) => void; ask: Ask }) {
  const toast = useToast((s) => s.show);
  const [lType, setLType] = useState('birth');
  const [lDate, setLDate] = useState(todayIso());
  const [lMember, setLMember] = useState('family');
  const [lNotes, setLNotes] = useState('');
  const life = ((apt.lifecycleEvents ?? []) as LifeEvent[]).map((e, i) => ({ e, i })).sort((a, b) => String(b.e.date).localeCompare(String(a.e.date)));

  const addLife = () => {
    if (!lDate) return;
    let n = 0;
    const undo = run((d) => { n = addLifeEvent(d, fref, { type: lType, date: lDate, memberKey: lMember, notes: lNotes.trim() }); });
    toast(`${lifeLabel(lType)} נרשם${n ? ` · נוצרו ${n} משימות המשך` : ''}`, undo);
    setLNotes('');
  };

  return (
    <>
      <div className="fc-sec">
        <h3>אירועי חיים</h3>
        <p className="muted fc-hint">לידה, חתונה, פטירה, עלייה ועוד. המערכת יוצרת משימות המשך לבד (למשל ברית, שלושים, יארצייט).</p>
        <form className="fc-add-col" onSubmit={(e) => { e.preventDefault(); addLife(); }}>
          <div className="fc-add">
            <select value={lType} onChange={(e) => setLType(e.target.value)} aria-label="סוג אירוע">{LIFE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            <input type="date" value={lDate} onChange={(e) => setLDate(e.target.value)} aria-label="תאריך" />
            <MemberSelect apt={apt} value={lMember} onChange={setLMember} />
          </div>
          <div className="fc-add">
            <input value={lNotes} onChange={(e) => setLNotes(e.target.value)} placeholder="הערות (לא חובה)" aria-label="הערות" />
            <button className="btn btn-primary" disabled={!lDate}>רישום</button>
          </div>
        </form>
        {life.length > 0 && (
          <ul className="fc-list">
            {life.map(({ e, i }) => (
              <li key={i}>
                <span><b>{lifeLabel(e.type)}</b>{e.memberName ? ` · ${e.memberName}` : ''}{e.notes ? <span className="meta"> · {e.notes}</span> : null}</span>
                <span className="fc-li-end">
                  {e.autoTasks ? <span className="pill pill-s">{e.autoTasks} משימות</span> : null}
                  <span className="meta">{e.date} · {hebOf(e.date)}</span>
                  <button className="ib" aria-label="מחיקה" onClick={() => void (async () => {
                    if (await ask({ title: 'מחיקת אירוע חיים', message: `למחוק את "${lifeLabel(e.type)}"? משימות ההמשך שנוצרו יישארו.`, confirm: 'מחיקה', danger: true })) run((d) => removeLifeEvent(d, fref, i), 'האירוע נמחק');
                  })()}><Icon name="x" size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fc-sec">
        <h3>אבני דרך ומועדים</h3>
        <Milestones apt={apt} onSave={onSave} ask={ask} types={getEventTypes(db).map((t) => ({ key: t.id, label: `${t.emoji ? `${t.emoji} ` : ''}${t.label}`, recurring: t.recurring }))} />
      </div>
    </>
  );
}

function Milestones({ apt, onSave, ask, types }: { apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void; ask: Ask; types: { key: string; label: string; recurring: boolean }[] }) {
  const MS_TYPES = types;
  const [type, setType] = useState('birthday');
  const [mode, setMode] = useState<'greg' | 'heb'>('heb');
  const [date, setDate] = useState('');
  const [hDay, setHDay] = useState(1);
  const [hMonth, setHMonth] = useState('תשרי');
  const [label, setLabel] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [err, setErr] = useState('');
  const list = (apt.milestones ?? []) as (Milestone & { id?: unknown })[];

  const add = () => {
    let greg = date;
    let day: number, monthName: string;
    if (mode === 'heb') {
      const next = nextOccurrence(hMonth, hDay);
      if (!next) { setErr('התאריך העברי לא תקין'); return; }
      greg = next.toISOString().slice(0, 10); day = hDay; monthName = hMonth;
    } else {
      const h = date ? hebrewParts(new Date(`${date}T12:00:00`)) : null;
      if (!h) { setErr('צריך לבחור תאריך'); return; }
      day = h.day; monthName = h.monthName;
    }
    const typeLabel = (MS_TYPES.find((t) => t.key === type)?.label ?? type).replace(/^\S+\s/u, (m) => (/\p{Extended_Pictographic}/u.test(m) ? '' : m));
    onSave({ milestones: [...list, { id: Date.now(), type, label: label.trim() || `${typeLabel} — ${apt.name ?? ''}`, day, monthName, gregDate: greg, recurring }] }, 'אבן הדרך נוספה');
    setLabel(''); setDate(''); setErr('');
  };

  const sorted = [...list].map((m) => ({ m, days: m.day && m.monthName ? daysUntil(String(m.monthName), Number(m.day)) : null }))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  return (
    <>
      <div className="fc-add-col">
        <div className="fc-add">
          <select value={type} onChange={(e) => { setType(e.target.value); setRecurring(MS_TYPES.find((t) => t.key === e.target.value)?.recurring ?? true); }} aria-label="סוג">{MS_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <div className="seg-s" role="group" aria-label="סוג תאריך">
            <button type="button" aria-pressed={mode === 'heb'} onClick={() => setMode('heb')}>עברי</button>
            <button type="button" aria-pressed={mode === 'greg'} onClick={() => setMode('greg')}>לועזי</button>
          </div>
        </div>
        <div className="fc-add">
          {mode === 'greg' ? <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="תאריך" /> : (
            <>
              <select value={hDay} onChange={(e) => setHDay(Number(e.target.value))} aria-label="יום">{Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{formatHebrew(d, '').trim()}</option>)}</select>
              <select value={hMonth} onChange={(e) => setHMonth(e.target.value)} aria-label="חודש">{HEB_MONTHS.map((m) => <option key={m}>{m}</option>)}</select>
            </>
          )}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="תיאור (לא חובה)" aria-label="תיאור" />
        </div>
        <div className="fc-add">
          <label className="chk-row"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />חוזר כל שנה</label>
          <button className="btn btn-primary" type="button" onClick={add}>הוספה</button>
          {err && <span className="err">{err}</span>}
        </div>
      </div>
      <ul className="fc-list">
        {sorted.map(({ m, days }, i) => {
          const year = m.gregDate ? hebrewParts(new Date(`${String(m.gregDate).slice(0, 10)}T12:00:00`))?.year : undefined;
          return (
            <li key={i}>
              <span><b>{String(m.label ?? '')}</b>{m.day && m.monthName ? <span className="meta"> · {formatHebrew(Number(m.day), String(m.monthName))}{!m.recurring && year ? ` ${hebrewYear(year)}` : ''}</span> : null}</span>
              <span className="meta">{days == null ? '' : days === 0 ? 'היום' : `בעוד ${days} ימים`}</span>
              <button className="ib" aria-label="הסרה" onClick={() => void (async () => {
                if (await ask({ title: 'הסרת אבן דרך', message: `להסיר את "${String(m.label ?? '')}"?`, confirm: 'הסרה', danger: true })) onSave({ milestones: list.filter((x) => x !== m) }, 'אבן הדרך הוסרה');
              })()}><Icon name="x" size={14} /></button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ───────── תיעוד שיחות ───────── */

type ConvDoc = { id: string; date?: string; channel?: string; docType?: string; title?: string; body?: string; recordingUrl?: string; createdAt?: number };

function Docs({ apt, onSave, ask }: { apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void; ask: Ask }) {
  const blank = () => ({ id: '', date: todayIso(), channel: 'general', docType: 'summary', title: '', body: '', recordingUrl: '' });
  const [f, setF] = useState(blank);
  const [fCh, setFCh] = useState('');
  const [fType, setFType] = useState('');
  const [q, setQ] = useState('');
  const docs = (((apt as Record<string, unknown>).convDocs ?? []) as ConvDoc[]);
  const isRec = f.docType === 'recording_link';
  const valid = isRec ? !!(f.recordingUrl.trim() || f.body.trim()) : !!f.body.trim();
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = () => {
    if (!valid) return;
    const fields = { date: f.date, channel: f.channel, docType: f.docType, title: f.title.trim(), body: f.body.trim(), recordingUrl: f.recordingUrl.trim() };
    // אותו מבנה כמו saveConvDoc במערכת הקיימת
    const next = f.id ? docs.map((d) => (d.id === f.id ? { ...d, ...fields } : d))
      : [...docs, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...fields, createdAt: Date.now() }];
    onSave({ convDocs: next } as never, f.id ? 'התיעוד עודכן' : 'התיעוד נשמר');
    setF(blank());
  };

  const ql = q.trim().toLowerCase();
  const shown = [...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .filter((d) => (!fCh || d.channel === fCh) && (!fType || d.docType === fType)
      && (!ql || `${d.title ?? ''} ${d.body ?? ''}`.toLowerCase().includes(ql)));

  return (
    <>
      <form className="fc-add-col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="fc-add">
          <select value={f.docType} onChange={set('docType')} aria-label="סוג תיעוד">{Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.channel} onChange={set('channel')} aria-label="ערוץ">{Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input type="date" value={f.date} onChange={set('date')} aria-label="תאריך" />
        </div>
        <input value={f.title} onChange={set('title')} placeholder="כותרת (לא חובה)" aria-label="כותרת" />
        {isRec && <input value={f.recordingUrl} onChange={set('recordingUrl')} placeholder="קישור להקלטה" dir="ltr" aria-label="קישור להקלטה" />}
        <textarea rows={4} value={f.body} onChange={set('body')} placeholder={isRec ? 'הערות להקלטה (לא חובה)' : f.docType === 'transcript' ? 'התמליל' : f.docType === 'thread' ? 'השרשור (העתקה מוואטסאפ/מייל)' : 'סיכום השיחה'} aria-label="תוכן" />
        <div className="fc-add">
          <button className="btn btn-primary" disabled={!valid}>{f.id ? 'עדכון' : 'שמירה'}</button>
          {f.id && <button type="button" className="btn" onClick={() => setF(blank())}>ביטול עריכה</button>}
        </div>
      </form>

      {docs.length > 1 && (
        <div className="fc-add fc-filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בתיעוד" aria-label="חיפוש בתיעוד" />
          <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="סינון לפי סוג"><option value="">כל הסוגים</option>{Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={fCh} onChange={(e) => setFCh(e.target.value)} aria-label="סינון לפי ערוץ"><option value="">כל הערוצים</option>{Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
      )}

      <ol className="timeline">
        {shown.map((d) => (
          <li key={d.id}>
            <b>{d.title || DOC_TYPES[String(d.docType)] || 'תיעוד'}</b>
            <span className="meta">{String(d.date ?? '')} · {DOC_CHANNELS[String(d.channel)] ?? ''}</span>
            <span className="pill pill-s">{DOC_TYPES[String(d.docType)] ?? 'סיכום'}</span>
            <span className="tl-acts">
              <button className="link" onClick={() => setF({ id: d.id, date: d.date ?? '', channel: d.channel ?? 'general', docType: d.docType ?? 'summary', title: d.title ?? '', body: d.body ?? '', recordingUrl: d.recordingUrl ?? '' })}>עריכה</button>
              <button className="ib" aria-label="מחיקת תיעוד" onClick={() => void (async () => {
                if (await ask({ title: 'מחיקת תיעוד', message: 'למחוק את התיעוד הזה?', confirm: 'מחיקה', danger: true })) onSave({ convDocs: docs.filter((x) => x.id !== d.id) } as never, 'התיעוד נמחק');
              })()}><Icon name="x" size={13} /></button>
            </span>
            {d.recordingUrl && <p><a href={d.recordingUrl} target="_blank" rel="noreferrer" dir="ltr">האזנה להקלטה</a></p>}
            {d.body && <p className="doc-body">{d.body}</p>}
          </li>
        ))}
      </ol>
      {docs.length > 0 && shown.length === 0 && <p className="muted">אין תיעוד שמתאים לסינון.</p>}
    </>
  );
}
