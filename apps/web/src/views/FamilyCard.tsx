import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Apartment, type Db, type Donation, type FamilyRef, type InteractionLog, type Milestone, type Task,
  NO_ADDRESS_KEY, brokenKind, buildingKeys, daysUntil, deleteFamily, displayName, familyAddress, familyPhones,
  formatHebrew, geocodeAddress, getAptScore, getBuilding, getStatusColor, hebrewParts, lastContact, moveFamily,
  nextOccurrence, splitFamily, statusSeverity, updateFamily, waLink,
} from '@shlichus/core';
import { Icon } from '../icons';
import { type ContactType, useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { missionCity } from '../mapData';
import { agoText } from './Community';

type Tab = 'details' | 'activity' | 'donations' | 'milestones' | 'docs';
const TABS: { key: Tab; label: string }[] = [
  { key: 'details', label: 'פרטים' }, { key: 'activity', label: 'פעילות' }, { key: 'donations', label: 'תרומות' },
  { key: 'milestones', label: 'אבני דרך' }, { key: 'docs', label: 'תיעוד' },
];
const LOG_TYPES = ['שיחה', 'ביקור', 'WhatsApp', 'מייל', 'פגישה', 'אחר'];
const MS_TYPES = [
  { key: 'birthday', label: 'יום הולדת' }, { key: 'yahrzeit', label: 'יארצייט' }, { key: 'anniversary', label: 'יום נישואין' },
  { key: 'barmitzva', label: 'בר/בת מצווה' }, { key: 'other', label: 'אחר' },
];
const HEB_MONTHS = ['תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר א׳', 'אדר ב׳', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול'];
const DOC_CHANNELS: Record<string, string> = { general: 'כללי', phone: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה' };
const SEV_CLASS = ['cold', 'ok', 'warm', 'hot'];
const SEV_TEXT = ['עוד לא היה קשר', 'בקשר', 'מתרחקים', 'צריך תשומת לב'];

const nowStamp = () => {
  const n = new Date();
  return `${n.toLocaleDateString('he-IL')} ${n.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export function FamilyCard({ db, fref, onClose, onMoved }: { db: Db; fref: FamilyRef; onClose: () => void; onMoved: (r: FamilyRef) => void }) {
  const apt = getBuilding(db, fref.bldg)!.apts[fref.idx]!;
  const mutate = useStore((s) => s.mutate);
  const logContact = useStore((s) => s.logContact);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const [tab, setTab] = useState<Tab>('details');
  const [addrOpen, setAddrOpen] = useState(false);
  const dirtyRef = useRef(false);

  const save = (patch: Partial<Apartment>, msg?: string) => {
    const undo = mutate((d) => updateFamily(d, fref, patch));
    if (msg) toast(msg, undo);
  };

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
  const deceased = (apt as { lifeStatus?: string }).lifeStatus === 'deceased';
  const name = displayName(apt) || 'משפחה חדשה';
  const initials = (apt.name || apt.father || apt.mother || '?').trim().slice(0, 2);

  const log = (t: ContactType, label: string) => { const undo = logContact(fref.bldg, fref.idx, t); toast(`${label} נרשם`, undo); };

  const remove = async () => {
    if (!(await ask({ title: 'מחיקת משפחה', message: `למחוק את ${name}? אפשר לבטל מיד אחרי.`, confirm: 'מחיקה', danger: true }))) return;
    const undo = mutate((d) => deleteFamily(d, fref));
    toast(`${name} נמחקה`, undo);
    onClose();
  };

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
          {lastContact(apt) && <span className="pill">קשר אחרון {agoText(lastContact(apt))}</span>}
          {apt.style && <span className="pill">{apt.style}</span>}
        </div>

        {deceased && (
          <div className="fc-mourn">
            לעילוי נשמת {String((apt as { deceasedInfo?: { who?: string } }).deceasedInfo?.who === 'father' ? apt.father || 'האב' : (apt as { deceasedInfo?: { who?: string } }).deceasedInfo?.who === 'mother' ? apt.mother || 'האם' : '')} ע״ה
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
          {tab === 'activity' && <Activity apt={apt} onSave={save} />}
          {tab === 'donations' && <Donations db={db} apt={apt} onSave={save} />}
          {tab === 'milestones' && <Milestones apt={apt} onSave={save} ask={ask} />}
          {tab === 'docs' && <Docs apt={apt} onSave={save} />}
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
    : t === 'milestones' ? (apt.milestones ?? []).length : t === 'docs' ? (((apt as Record<string, unknown>).convDocs ?? []) as unknown[]).length : 0;
  return n ? ` · ${n}` : '';
}

/* ───────── פרטים ───────── */

function Details({ db, apt, onDirty, onSave, onDeceased, onSplit, onDelete }: {
  db: Db; apt: Apartment; onDirty: (v: boolean) => void; onSave: (p: Partial<Apartment>) => void;
  onDeceased: (p: Partial<Apartment>) => void; onSplit: (member: string) => void; onDelete: () => void;
}) {
  const s = db.__SETTINGS__ ?? {};
  const init = () => ({
    name: apt.name ?? '', num: String(apt.num ?? ''), father: apt.father ?? '', mother: apt.mother ?? '',
    fatherPhone: String(apt.fatherPhone ?? ''), motherPhone: String(apt.motherPhone ?? ''),
    fatherEmail: String(apt.fatherEmail ?? ''), motherEmail: String(apt.motherEmail ?? ''),
    style: apt.style ?? '', notes: String(apt.notes ?? ''),
  });
  const [f, setF] = useState(init);
  const [tags, setTags] = useState<string[]>([...(apt.tags ?? [])]);
  const [kids, setKids] = useState<{ name?: string; phone?: string }[]>([...((apt.childrenList ?? []) as { name?: string; phone?: string }[])]);
  const [boards, setBoards] = useState<Record<string, string>>({ ...((apt.boards ?? {}) as Record<string, string>) });
  const [custom, setCustom] = useState<Record<string, unknown>>({ ...((apt.customData ?? apt.customFields ?? {}) as Record<string, unknown>) });
  const [dirty, setDirty] = useState(false);
  const [dlg, setDlg] = useState<'deceased' | 'split' | null>(null);
  const touch = () => { setDirty(true); onDirty(true); };
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); touch(); };

  const styles = (s.styles ?? []) as string[];
  const allTags = (s.tags ?? []) as string[];
  const customFields = (s.customFields ?? []) as string[];
  const boardsList = (db.__BOARDS__ ?? []).filter((b) => !b.archived);

  const submit = () => {
    onSave({ ...f, tags, childrenList: kids, boards, customData: custom, customFields: custom } as Partial<Apartment>);
    setDirty(false);
  };

  return (
    <form className="fc-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="fc-grid">
        <Fld label="שם משפחה"><input value={f.name} onChange={set('name')} /></Fld>
        <Fld label="דירה"><input value={f.num} onChange={set('num')} inputMode="numeric" /></Fld>
        <Fld label="שם האב"><input value={f.father} onChange={set('father')} /></Fld>
        <Fld label="טלפון האב"><input value={f.fatherPhone} onChange={set('fatherPhone')} dir="ltr" inputMode="tel" /></Fld>
        <Fld label="שם האם"><input value={f.mother} onChange={set('mother')} /></Fld>
        <Fld label="טלפון האם"><input value={f.motherPhone} onChange={set('motherPhone')} dir="ltr" inputMode="tel" /></Fld>
        <Fld label="מייל האב"><input value={f.fatherEmail} onChange={set('fatherEmail')} dir="ltr" inputMode="email" /></Fld>
        <Fld label="מייל האם"><input value={f.motherEmail} onChange={set('motherEmail')} dir="ltr" inputMode="email" /></Fld>
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

      <div className="fc-sec">
        <h3>ילדים <span className="num">{kids.length || ''}</span></h3>
        {kids.map((k, i) => (
          <div className="fc-row" key={i}>
            <input placeholder="שם" value={k.name ?? ''} onChange={(e) => { setKids((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); touch(); }} aria-label="שם הילד/ה" />
            <input placeholder="טלפון" dir="ltr" value={k.phone ?? ''} onChange={(e) => { setKids((a) => a.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x))); touch(); }} aria-label="טלפון הילד/ה" />
            <button type="button" className="ib" onClick={() => { setKids((a) => a.filter((_, j) => j !== i)); touch(); }} aria-label="הסרה"><Icon name="x" size={14} /></button>
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

/* ───────── פעילות ───────── */

function Activity({ apt, onSave }: { apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void }) {
  const [type, setType] = useState('שיחה');
  const [text, setText] = useState('');
  const [task, setTask] = useState('');
  const [due, setDue] = useState('');
  const tasks = (apt.tasks ?? []) as Task[];
  const logs = apt.interactions ?? [];
  return (
    <>
      <form className="fc-add" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; const l: InteractionLog = { date: nowStamp(), type, notes: text.trim(), source: 'web' }; onSave({ interactions: [l, ...logs] }, 'התיעוד נשמר'); setText(''); }}>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="סוג">{LOG_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="מה היה? תיעוד קצר" aria-label="תיעוד" />
        <button className="btn btn-primary" disabled={!text.trim()}>תיעוד</button>
      </form>

      <div className="fc-sec">
        <h3>משימות <span className="num">{tasks.filter((t) => !t.done).length || ''}</span></h3>
        <form className="fc-add" onSubmit={(e) => { e.preventDefault(); if (!task.trim()) return; onSave({ tasks: [...tasks, { text: task.trim(), due, done: false }] }, 'המשימה נוספה'); setTask(''); setDue(''); }}>
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="משימה חדשה" aria-label="משימה" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="תאריך יעד" />
          <button className="btn" disabled={!task.trim()}>הוספה</button>
        </form>
        <ul className="fc-list">
          {tasks.map((t, i) => (
            <li key={i} className={t.done ? 'done' : ''}>
              <label className="chk-row"><input type="checkbox" checked={!!t.done} onChange={() => onSave({ tasks: tasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />{String(t.text ?? '')}</label>
              {(t.due || t.date) ? <span className="meta">{String(t.due ?? t.date)}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="fc-sec">
        <h3>יומן <span className="num">{logs.length || ''}</span></h3>
        {logs.length === 0 ? <p className="muted">עוד אין תיעוד.</p> : (
          <ol className="timeline">
            {logs.slice(0, 60).map((l, i) => (
              <li key={i}><b>{String(l.type ?? '')}</b><span className="meta">{String(l.date ?? '')}</span>{(l.notes || l.text) && <p>{String(l.notes ?? l.text)}</p>}</li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

/* ───────── תרומות ───────── */

function Donations({ db, apt, onSave }: { db: Db; apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void }) {
  const [amount, setAmount] = useState('');
  const [campaign, setCampaign] = useState('');
  const campaigns = ((db.__SETTINGS__?.campaigns ?? []) as { key: string; label: string; active?: boolean }[]).filter((c) => c.active !== false);
  const list = [...(apt.donations ?? [])].reverse();
  const total = list.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  return (
    <>
      <form className="fc-add" onSubmit={(e) => { e.preventDefault(); const n = Number(amount); if (!n) return; const d: Donation = { date: todayIso(), amount: n, campaign: campaign.trim() }; onSave({ donations: [...(apt.donations ?? []), d] }, `נרשמה תרומה של ₪${n.toLocaleString('he-IL')}`); setAmount(''); }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="סכום ₪" inputMode="decimal" dir="ltr" aria-label="סכום" />
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="קמפיין">
          <option value="">כללי</option>
          {campaigns.map((c) => <option key={c.key} value={c.label}>{c.label}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!Number(amount)}>רישום תרומה</button>
      </form>
      <div className="fc-total"><span>סה״כ</span><b className="num">₪{total.toLocaleString('he-IL')}</b><span>{list.length} תרומות</span></div>
      <ul className="fc-list">
        {list.map((d, i) => <li key={i}><b className="num">₪{Number(d.amount ?? 0).toLocaleString('he-IL')}</b><span>{d.campaign || 'כללי'}</span><span className="meta">{String(d.date ?? '')}</span></li>)}
      </ul>
    </>
  );
}

/* ───────── אבני דרך ───────── */

function Milestones({ apt, onSave, ask }: { apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void; ask: ReturnType<typeof useConfirm.getState>['ask'] }) {
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
    const typeLabel = MS_TYPES.find((t) => t.key === type)?.label ?? type;
    onSave({ milestones: [...list, { id: Date.now(), type, label: label.trim() || `${typeLabel} — ${apt.name ?? ''}`, day, monthName, gregDate: greg, recurring }] }, 'אבן הדרך נוספה');
    setLabel(''); setDate(''); setErr('');
  };

  const sorted = [...list].map((m) => ({ m, days: m.day && m.monthName ? daysUntil(String(m.monthName), Number(m.day)) : null }))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  return (
    <>
      <div className="fc-add-col">
        <div className="fc-add">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="סוג">{MS_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
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
        {sorted.map(({ m, days }, i) => (
          <li key={i}>
            <span><b>{String(m.label ?? '')}</b>{m.day && m.monthName ? <span className="meta"> · {formatHebrew(Number(m.day), String(m.monthName))}</span> : null}</span>
            <span className="meta">{days == null ? '' : days === 0 ? 'היום' : `בעוד ${days} ימים`}</span>
            <button className="ib" aria-label="הסרה" onClick={() => void (async () => {
              if (await ask({ title: 'הסרת אבן דרך', message: `להסיר את "${String(m.label ?? '')}"?`, confirm: 'הסרה', danger: true })) onSave({ milestones: list.filter((x) => x !== m) }, 'אבן הדרך הוסרה');
            })()}><Icon name="x" size={14} /></button>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ───────── תיעוד שיחות ───────── */

function Docs({ apt, onSave }: { apt: Apartment; onSave: (p: Partial<Apartment>, msg?: string) => void }) {
  const [channel, setChannel] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const docs = (((apt as Record<string, unknown>).convDocs ?? []) as Record<string, unknown>[]);
  return (
    <>
      <form className="fc-add-col" onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        // אותו מבנה כמו saveConvDoc במערכת הקיימת
        const doc = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: todayIso(), channel, docType: 'summary', title: title.trim(), body: body.trim(), recordingUrl: '', createdAt: Date.now() };
        onSave({ convDocs: [...docs, doc] } as never, 'התיעוד נשמר');
        setTitle(''); setBody('');
      }}>
        <div className="fc-add">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="ערוץ">{Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת (לא חובה)" aria-label="כותרת" />
        </div>
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="סיכום השיחה" aria-label="סיכום" />
        <div className="fc-add"><button className="btn btn-primary" disabled={!body.trim()}>שמירה</button></div>
      </form>
      <ol className="timeline">
        {[...docs].reverse().map((d, i) => (
          <li key={i}><b>{String(d.title || DOC_CHANNELS[String(d.channel)] || 'תיעוד')}</b><span className="meta">{String(d.date ?? '')} · {DOC_CHANNELS[String(d.channel)] ?? ''}</span><p>{String(d.body ?? '')}</p></li>
        ))}
      </ol>
    </>
  );
}
