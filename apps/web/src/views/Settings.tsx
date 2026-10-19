import { useState } from 'react';
import {
  type BuildingCategory, type Db, type Direction, type InteractionType, type Mapping, DEFAULT_SCORING_RULES, DIRECTION_LABELS,
  IMPORT_FIELDS, type ScoringRules, displayName, familyPhones, geocodeAddress, getCategories, getInteractionTypes, getTerritory,
  guessMapping, importRows, listFamilies, mergeDb, parseCsv, renameListValue, scoreWeights, setSetting, updateFamily,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { browserTokens } from '../auth';
import { ACCENTS, applyAccent } from '../accent';
import { TerritoryEditor } from './TerritoryEditor';
import '../community.css';
import '../settings.css';

type Tab = 'general' | 'area' | 'lists' | 'scoring' | 'data';
const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: 'כללי' }, { key: 'area', label: 'אזור השליחות' }, { key: 'lists', label: 'רשימות' },
  { key: 'scoring', label: 'ניקוד' }, { key: 'data', label: 'ייבוא וגיבוי' },
];

export function Settings({ db }: { db: Db }) {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <>
      <section className="hello"><div><h1>הגדרות</h1><p className="lede">כל שינוי נשמר מיד, ואפשר לבטל אותו.</p></div></section>
      <nav className="msg-tabs" role="tablist">{TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}</nav>
      {tab === 'general' && <General db={db} />}
      {tab === 'area' && <Area db={db} />}
      {tab === 'lists' && <Lists db={db} />}
      {tab === 'scoring' && <Scoring db={db} />}
      {tab === 'data' && <DataTab db={db} />}
    </>
  );
}

/** שמירה של שדה הגדרות עם ביטול */
function useSetting() {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  return (patch: Record<string, unknown>, msg = 'נשמר') => { const undo = mutate((d) => setSetting(d, patch)); toast(msg, undo); };
}

/* ───────── כללי ───────── */

function General({ db }: { db: Db }) {
  const save = useSetting();
  const s = db.__SETTINGS__ ?? {};
  const home = (s.homeLocation ?? {}) as { address?: string; coords?: [number, number] };
  const [name, setName] = useState(String(s.missionName ?? ''));
  const [addr, setAddr] = useState(String(home.address ?? ''));
  const [goal, setGoal] = useState(String(s.weeklyGoal ?? 20));
  const [msg, setMsg] = useState('');
  const accent = String(s.webAccent ?? 'teal');

  const saveAddress = async () => {
    const parts = addr.split(',').map((x) => x.trim()).filter(Boolean);
    const city = parts.length > 1 ? parts[parts.length - 1]! : '';
    if (!city) { setMsg('צריך לכתוב גם עיר, למשל: שמואל תמיר 19, ירושלים'); return; }
    setMsg('מאתר את הכתובת…');
    const hit = await geocodeAddress(parts.slice(0, -1).join(' '), city).catch(() => null);
    if (!hit) { setMsg('הכתובת לא נמצאה ברישום הרשמי. כדאי לבדוק את האיות ואת מספר הבית.'); return; }
    const loc = { coords: hit.point, address: addr.trim() };
    save({ homeLocation: { ...home, ...loc, isChabad: true }, primaryLocation: loc }, 'המיקום עודכן');
    setMsg(`נמצא: ${hit.text}`);
  };

  return (
    <div className="set-grid">
      <section className="panel set-card">
        <h2>השליחות</h2>
        <label className="fld"><span>שם (מופיע בתפריט ובהודעות)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== String(s.missionName ?? '') && save({ missionName: name.trim(), branding: { ...((s.branding ?? {}) as object), name: name.trim() } })} />
        </label>
        <label className="fld"><span>כתובת בית חב״ד (מרכז המפה)</span>
          <span className="set-row"><input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="רחוב ומספר, עיר" /><button className="btn" onClick={() => void saveAddress()}>איתור ושמירה</button></span>
        </label>
        {msg && <p className="sheet-hint">{msg}</p>}
      </section>
      <section className="panel set-card">
        <h2>יעד שבועי</h2>
        <p className="sheet-hint">כמה משפחות לפגוש או לדבר איתן בשבוע. מופיע במסך היום.</p>
        <span className="set-row"><input className="num-in" value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="יעד שבועי" />
          <button className="btn" disabled={!Number(goal) || Number(goal) === Number(s.weeklyGoal ?? 20)} onClick={() => save({ weeklyGoal: Number(goal) }, 'היעד עודכן')}>שמירה</button></span>
      </section>
      <section className="panel set-card">
        <h2>לוגו</h2>
        <p className="sheet-hint">מופיע בתפריט ובסימון בית חב״ד במפה.</p>
        <div className="logo-row">
          {s.logo ? <img className="logo-prev" src={String(s.logo)} alt="הלוגו" /> : <div className="logo-prev empty">ש</div>}
          <label className="btn file-btn">{s.logo ? 'החלפה' : 'העלאת לוגו'}<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void shrinkImage(f).then((url) => save({ logo: url, branding: { ...((s.branding ?? {}) as object), logo: url } }, 'הלוגו עודכן')); e.target.value = ''; }} /></label>
          {s.logo ? <button className="btn btn-ghost-danger" onClick={() => save({ logo: '', branding: { ...((s.branding ?? {}) as object), logo: '' } }, 'הלוגו הוסר')}>הסרה</button> : null}
        </div>
      </section>
      <section className="panel set-card">
        <h2>צבע המערכת</h2>
        <div className="accents">
          {ACCENTS.map((a) => (
            <button key={a.id} className="acc" aria-pressed={accent === a.id} style={{ ['--a' as string]: a.light[0] }} onClick={() => { applyAccent(a.id); save({ webAccent: a.id }, 'הצבע עודכן'); }}>
              <i />{a.name}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** הקטנת תמונה ל-192 פיקסלים (נשמרת בקובץ הנתונים) */
function shrinkImage(f: File, max = 192): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/png'));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(f);
  });
}

/* ───────── אזור השליחות ───────── */

function Area({ db }: { db: Db }) {
  const save = useSetting();
  const t = getTerritory(db);
  const mode = String(t.displayMode ?? 'border');
  return (
    <>
      <section className="panel set-card wide">
        <h2>תיחום אזור השליחות</h2>
        <TerritoryEditor db={db} />
      </section>
      <section className="panel set-card">
        <h2>הצגת התיחום במפה</h2>
        <div className="seg" role="group">
          {([['border', 'קו גבול'], ['fill', 'הכהיית החוץ'], ['none', 'בלי']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={mode === k} onClick={() => save({ territory: { ...t, displayMode: k } })}>{l}</button>
          ))}
        </div>
      </section>
    </>
  );
}

/* ───────── רשימות ───────── */

function ChipList({ title, hint, items, colors, onChange, onColor, onRename, placeholder }: {
  title: string; hint?: string; items: string[]; colors?: Record<string, string>; placeholder: string;
  onChange: (next: string[]) => void; onColor?: (item: string, color: string) => void; onRename?: (from: string, to: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const ask = useConfirm((s) => s.ask);
  return (
    <section className="panel set-card">
      <h2>{title}</h2>
      {hint && <p className="sheet-hint">{hint}</p>}
      <div className="chips">
        {items.map((it) => (
          <span className="mchip" key={it}>
            {onColor && <input type="color" className="swatch" value={colors?.[it] ?? '#0e6b64'} onChange={(e) => onColor(it, e.target.value)} aria-label={`צבע ${it}`} />}
            {onRename ? <button className="mchip-name" title="שינוי שם" onClick={() => setRenaming(it)}>{it}</button> : it}
            <button className="mx" aria-label={`הסרת ${it}`} onClick={() => void (async () => { if (await ask({ title: 'הסרה', message: `להסיר את "${it}" מהרשימה? משפחות שכבר מסומנות לא משתנות.`, confirm: 'הסרה' })) onChange(items.filter((x) => x !== it)); })()}>×</button>
          </span>
        ))}
        {items.length === 0 && <span className="muted">אין עדיין.</span>}
      </div>
      <form className="fc-add" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v && !items.includes(v)) onChange([...items, v]); setDraft(''); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={`הוספה ל${title}`} />
        <button className="btn" disabled={!draft.trim()}>הוספה</button>
      </form>
      {renaming && onRename && <RenameDialog value={renaming} existing={items} onClose={() => setRenaming(null)} onSave={(to) => { onRename(renaming, to); setRenaming(null); }} />}
    </section>
  );
}

function RenameDialog({ value, existing, onClose, onSave }: { value: string; existing: string[]; onClose: () => void; onSave: (to: string) => void }) {
  const [v, setV] = useState(value);
  const t = v.trim();
  const clash = t !== value && existing.includes(t);
  return (
    <Dialog title={`שינוי שם: ${value}`} onClose={onClose}>
      <label className="fld"><span>שם חדש</span><input value={v} onChange={(e) => setV(e.target.value)} /></label>
      <p className="dialog-note">{clash ? 'השם כבר קיים — המשפחות יאוחדו תחתיו.' : 'השם יתעדכן בכל המשפחות שמסומנות בו.'}</p>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!t || t === value} onClick={() => onSave(t)}>שמירה</button></div>
    </Dialog>
  );
}

function Lists({ db }: { db: Db }) {
  const save = useSetting();
  const mutate = useStore((st) => st.mutate);
  const toast = useToast((st) => st.show);
  const rename = (kind: 'tags' | 'styles') => (from: string, to: string) => {
    let n = 0;
    const undo = mutate((d) => { n = renameListValue(d, kind, from, to); });
    toast(`"${from}" שונה ל"${to}"${n ? ` · עודכנו ${n} משפחות` : ''}`, undo);
  };
  const s = db.__SETTINGS__ ?? {};
  const t = getTerritory(db);
  const cats = getCategories(db);
  const eventTypes = (s.customEventTypes ?? []) as { id: string; label: string; emoji?: string; color?: string; recurring?: boolean }[];
  const setCats = (next: BuildingCategory[]) => save({ territory: { ...t, categories: next } }, 'סוגי הבניינים נשמרו');
  const [newCat, setNewCat] = useState('');
  return (
    <div className="set-grid">
      <ChipList title="תגיות" items={(s.tags ?? []) as string[]} colors={(s.tagColors ?? {}) as Record<string, string>} placeholder="תגית חדשה"
        onChange={(tags) => save({ tags })} onRename={rename('tags')} onColor={(it, c) => save({ tagColors: { ...((s.tagColors ?? {}) as object), [it]: c } })} />
      <ChipList title="סגנונות" items={(s.styles ?? []) as string[]} colors={(s.styleColors ?? {}) as Record<string, string>} placeholder="סגנון חדש"
        onChange={(styles) => save({ styles })} onRename={rename('styles')} onColor={(it, c) => save({ styleColors: { ...((s.styleColors ?? {}) as object), [it]: c } })} />
      <ChipList title="שדות אישיים למשפחה" hint="שדות נוספים שמופיעים בכרטיס כל משפחה, למשל ארץ מוצא." items={(s.customFields ?? []) as string[]} placeholder="שם השדה"
        onChange={(customFields) => save({ customFields })} />
      <section className="panel set-card">
        <h2>סוגי בניינים</h2>
        <p className="sheet-hint">הסוגים שמופיעים בכרטיס הבניין ובצביעת המפה.</p>
        <ul className="fc-list">
          {cats.map((c) => (
            <li key={c.id}>
              <span className="set-row"><input type="color" className="swatch" value={c.color} onChange={(e) => setCats(cats.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)))} aria-label={`צבע ${c.name}`} />
                <input className="inline-in" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && setCats(cats.map((x) => (x.id === c.id ? { ...x, name: e.target.value.trim() } : x)))} aria-label="שם הסוג" /></span>
              {c.isDefault && <span className="meta">ברירת מחדל</span>}
            </li>
          ))}
        </ul>
        <form className="fc-add" onSubmit={(e) => { e.preventDefault(); if (!newCat.trim()) return; setCats([...cats, { id: `cat_${Date.now()}`, name: newCat.trim(), color: '#64748b', hasCard: true }]); setNewCat(''); }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="סוג חדש" aria-label="סוג בניין חדש" /><button className="btn" disabled={!newCat.trim()}>הוספה</button>
        </form>
      </section>
      <section className="panel set-card">
        <h2>סוגי אירועים</h2>
        <ul className="fc-list">
          {eventTypes.map((e) => (
            <li key={e.id}><span>{e.emoji} {e.label}{e.recurring ? <span className="meta"> · חוזר כל שנה</span> : null}</span>
              <button className="ib" aria-label={`מחיקת ${e.label}`} onClick={() => save({ customEventTypes: eventTypes.filter((x) => x.id !== e.id) }, 'נמחק')}><Icon name="x" size={13} /></button></li>
          ))}
          {eventTypes.length === 0 && <li className="muted">אין סוגים מותאמים.</li>}
        </ul>
        <EventTypeForm onAdd={(label, recurring) => save({ customEventTypes: [...eventTypes, { id: `custom_${Date.now()}`, label, emoji: '📅', color: '#0e6b64', recurring }] }, 'נוסף')} />
      </section>
    </div>
  );
}

function EventTypeForm({ onAdd }: { onAdd: (label: string, recurring: boolean) => void }) {
  const [label, setLabel] = useState('');
  const [rec, setRec] = useState(true);
  return (
    <form className="fc-add" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { onAdd(label.trim(), rec); setLabel(''); } }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="סוג אירוע חדש" aria-label="סוג אירוע חדש" />
      <label className="chk-row"><input type="checkbox" checked={rec} onChange={(e) => setRec(e.target.checked)} />חוזר</label>
      <button className="btn" disabled={!label.trim()}>הוספה</button>
    </form>
  );
}

/* ───────── ניקוד ───────── */

function Scoring({ db }: { db: Db }) {
  const save = useSetting();
  const rules = ((db.__SETTINGS__?.scoringRules ?? DEFAULT_SCORING_RULES) as ScoringRules);
  const channels = rules.channels?.length ? rules.channels : DEFAULT_SCORING_RULES.channels;
  const th = rules.thresholds ?? DEFAULT_SCORING_RULES.thresholds;
  const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
  const setRules = (next: ScoringRules) => save({ scoringRules: next }, 'הניקוד עודכן');
  return (
    <div className="set-grid">
      <section className="panel set-card wide">
        <h2>איך קשר הופך לצבע</h2>
        <p className="sheet-hint">כל סוג קשר שווה נקודות לתקופה מסוימת. סכום הנקודות של משפחה קובע את הצבע שלה במפה וברשימות.</p>
        <table className="score-tbl">
          <thead><tr><th>סוג קשר</th><th>נקודות</th><th>תקף (ימים)</th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.key}>
                <td>{c.label ?? c.key}</td>
                <td><input className="num-in" defaultValue={c.points} inputMode="numeric" aria-label={`נקודות ל${c.label ?? c.key}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v !== c.points) setRules({ ...rules, channels: channels.map((x) => (x.key === c.key ? { ...x, points: v } : x)) }); }} /></td>
                <td><input className="num-in" defaultValue={c.ttlDays} inputMode="numeric" aria-label={`ימים ל${c.label ?? c.key}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v !== c.ttlDays) setRules({ ...rules, channels: channels.map((x) => (x.key === c.key ? { ...x, ttlDays: v } : x)) }); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="th-row">
          <span className="dot ok" />בקשר מ-<input className="num-in" defaultValue={th.green} inputMode="numeric" aria-label="סף ירוק" onBlur={(e) => { const v = num(e.target.value); if (v !== null && v !== th.green) setRules({ ...rules, thresholds: { ...th, green: v } }); }} />נקודות
          <span className="dot warm" />מתרחקים מ-<input className="num-in" defaultValue={th.orange} inputMode="numeric" aria-label="סף כתום" onBlur={(e) => { const v = num(e.target.value); if (v !== null && v !== th.orange) setRules({ ...rules, thresholds: { ...th, orange: v } }); }} />נקודות
          <span className="dot hot" />מתחת לזה: צריך תשומת לב
        </div>
      </section>
      <InteractionTypesEditor db={db} />
    </div>
  );
}

/** סוגי הפעילות (כמו scoring.js): שם, כיוון, משקל לציון המעורבות, צבע; וזמן מחצית */
function InteractionTypesEditor({ db }: { db: Db }) {
  const save = useSetting();
  const s = db.__SETTINGS__;
  const types = getInteractionTypes(s);
  const w = scoreWeights(s);
  const decay = Number(s?.scoreDecayDays) > 0 ? Number(s?.scoreDecayDays) : 90;
  const [label, setLabel] = useState('');
  const write = (next: InteractionType[], weights: Record<string, number>, msg: string) => save({ interactionTypes: next, scoreWeights: weights }, msg);
  const setT = (key: string, patch: Partial<InteractionType>) => write(types.map((t) => (t.key === key ? { ...t, ...patch } : t)), w, 'הסוג עודכן');
  return (
    <section className="panel set-card wide">
      <h2>סוגי פעילות וציון מעורבות</h2>
      <p className="sheet-hint">הסוגים שמופיעים בתיעוד בכרטיס המשפחה. כל סוג שווה נקודות לציון המעורבות (0–100), והנקודות נחלשות עם הזמן.</p>
      <table className="score-tbl it-tbl">
        <thead><tr><th>צבע</th><th>סוג</th><th>כיוון</th><th>נקודות</th><th /></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.key}>
              <td><input type="color" className="swatch" value={t.color} onChange={(e) => setT(t.key, { color: e.target.value })} aria-label={`צבע ${t.label}`} /></td>
              <td><input className="inline-in" defaultValue={t.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.label) setT(t.key, { label: v }); }} aria-label="שם הסוג" /></td>
              <td><select className="sel" value={t.direction} onChange={(e) => setT(t.key, { direction: e.target.value as Direction })} aria-label="כיוון">{(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}</select></td>
              <td><input className="num-in" defaultValue={w[t.key] ?? t.defaultScore} inputMode="numeric" aria-label={`נקודות ל${t.label}`} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v >= 0 && v !== (w[t.key] ?? t.defaultScore)) write(types, { ...w, [t.key]: v }, 'הנקודות עודכנו'); }} /></td>
              <td>{t.key !== 'other' && <button className="ib" aria-label={`מחיקת ${t.label}`} onClick={() => { const nw = { ...w }; delete nw[t.key]; write(types.filter((x) => x.key !== t.key), nw, `"${t.label}" נמחק`); }}><Icon name="x" size={13} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="fc-add" onSubmit={(e) => {
        e.preventDefault();
        const l = label.trim();
        if (!l || types.some((t) => t.label === l)) return;
        const key = `t_${Date.now().toString(36)}`;
        write([...types, { key, label: l, color: '#64748b', direction: 'outgoing', defaultScore: 10 }], { ...w, [key]: 10 }, `"${l}" נוסף`);
        setLabel('');
      }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="סוג פעילות חדש, למשל: התוועדות" aria-label="סוג פעילות חדש" />
        <button className="btn" disabled={!label.trim()}>הוספה</button>
      </form>
      <div className="th-row">ציון יורד לחצי אחרי <input className="num-in" defaultValue={decay} inputMode="numeric" aria-label="זמן מחצית בימים" onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v > 0 && v !== decay) save({ scoreDecayDays: v }, 'עודכן'); }} /> ימים</div>
    </section>
  );
}

/* ───────── ייבוא וגיבוי ───────── */

function DataTab({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [contacts, setContacts] = useState<{ name: string; phone: string; sel: boolean }[] | null>(null);
  const [busy, setBusy] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [fills, setFills] = useState<{ ref: { bldg: string; idx: number }; name: string; field: string; label: string; value: string; sel: boolean }[] | null>(null);

  /** גיליון גוגל: קודם דרך החיבור לגוגל (כמו בישן), ואם אין הרשאה — גיליון ששותף בקישור */
  const fetchSheet = async () => {
    const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) { toast('הקישור לא נראה כמו גיליון של גוגל שיטס'); return; }
    const id = m[1]!;
    const gid = sheetUrl.match(/[#&?]gid=(\d+)/)?.[1] ?? '';
    setBusy('sheet');
    try {
      let values: string[][] | null = null;
      const token = await browserTokens.getToken().catch(() => null);
      if (token) {
        const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:Z5000`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
        if (r?.ok) values = ((await r.json()) as { values?: string[][] }).values ?? null;
      }
      if (!values) {
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`);
        if (!r.ok) throw new Error(String(r.status));
        values = parseCsv(await r.text());
      }
      if (!values || values.length < 2) { toast('הגיליון ריק'); return; }
      setRows(values); setMapping(guessMapping(values[0]!));
    } catch {
      toast('לא הצלחנו לקרוא את הגיליון. בגוגל שיטס: שיתוף ← "כל מי שיש לו את הקישור" ← צפייה, ואז לנסות שוב.');
    } finally { setBusy(''); }
  };

  const onFile = async (f: File) => {
    const text = await f.text();
    const r = parseCsv(text);
    if (r.length < 2) { toast('לא נמצאו שורות בקובץ'); return; }
    setRows(r); setMapping(guessMapping(r[0]!));
  };
  const runImport = () => {
    if (!rows) return;
    let res = { imported: 0, skipped: 0, noAddress: 0 };
    const undo = mutate((d) => { res = importRows(d, rows, mapping); });
    toast(`יובאו ${res.imported} משפחות${res.skipped ? `, ${res.skipped} דולגו (כפולות או ריקות)` : ''}`, undo);
    setRows(null);
  };

  const backup = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `גיבוי-השליחות-שלי-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const restore = async (f: File) => {
    try {
      const imported = JSON.parse(await f.text()) as Db;
      if (!(await ask({ title: 'שחזור מגיבוי', message: 'לשלב את הגיבוי בנתונים הקיימים? שום דבר לא יימחק: רשומות חדשות מתווספות, וקיימות מתעדכנות לפי הגרסה החדשה יותר.', confirm: 'שחזור' }))) return;
      const undo = mutate((d) => { const merged = mergeDb(d, imported); for (const k of Object.keys(merged)) d[k] = merged[k]; });
      toast('הגיבוי שולב', undo);
    } catch { toast('הקובץ אינו גיבוי תקין'); }
  };

  const scanContacts = async () => {
    setBusy('contacts');
    try {
      const token = (await browserTokens.getToken()) ?? (await browserTokens.refresh());
      if (!token) { toast('צריך להתחבר לגוגל'); return; }
      const have = new Set(listFamilies(db).flatMap((f) => familyPhones(f.apt)));
      const found: { name: string; phone: string; sel: boolean }[] = [];
      const all: { name: string; phones: string[]; email: string }[] = [];
      let page = '';
      do {
        const url = new URL('https://people.googleapis.com/v1/people/me/connections');
        url.searchParams.set('personFields', 'names,phoneNumbers,emailAddresses');
        url.searchParams.set('pageSize', '1000');
        if (page) url.searchParams.set('pageToken', page);
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { connections?: { names?: { displayName?: string }[]; phoneNumbers?: { value?: string }[]; emailAddresses?: { value?: string }[] }[]; nextPageToken?: string };
        all.push(...(d.connections ?? []).map((c) => ({ name: c.names?.[0]?.displayName ?? '', phones: (c.phoneNumbers ?? []).map((p) => (p.value ?? '').replace(/[^\d+]/g, '').replace(/^\+972/, '0')).filter((p) => p.length >= 9), email: c.emailAddresses?.[0]?.value ?? '' })));
        for (const c of d.connections ?? []) {
          const name = c.names?.[0]?.displayName ?? '';
          const phone = c.phoneNumbers?.[0]?.value ?? '';
          const clean = phone.replace(/[^\d+]/g, '').replace(/^\+972/, '0');
          if (name && clean.length >= 9 && !have.has(clean)) found.push({ name, phone, sel: false });
        }
        page = d.nextPageToken ?? '';
      } while (page);
      setContacts(found);
      // השלמת פרטים למשפחות קיימות: מייל לפי טלפון זהה, טלפון לפי שם מלא (שם פרטי + משפחה)
      const sugg: NonNullable<typeof fills> = [];
      for (const f of listFamilies(db)) {
        const a = f.apt;
        const name = displayName(a);
        const ph = familyPhones(a);
        const byPhone = all.find((c) => c.phones.some((p) => ph.includes(p)));
        if (byPhone?.email && !a.fatherEmail && !a.motherEmail) sugg.push({ ref: f, name, field: 'fatherEmail', label: 'מייל', value: byPhone.email, sel: true });
        for (const [role, phoneKey] of [['father', 'fatherPhone'], ['mother', 'motherPhone']] as const) {
          const first = a[role]?.trim();
          if (!first || !a.name || a[phoneKey]) continue;
          const last = a.name.trim();
          const full = `${first} ${last}`;
          const c = all.find((x) => x.phones.length && (x.name === full || x.name === `${last} ${first}`));
          if (c && !ph.includes(c.phones[0]!)) sugg.push({ ref: f, name, field: phoneKey, label: role === 'father' ? 'טלפון האב' : 'טלפון האם', value: c.phones[0]!, sel: true });
        }
      }
      setFills(sugg.length ? sugg : null);
      if (!found.length && !sugg.length) toast('כל אנשי הקשר שלך כבר במערכת, ואין פרטים להשלים');
    } catch { toast('לא הצלחנו לקרוא את אנשי הקשר. צריך להפעיל את חיבור אנשי הקשר בגוגל.'); } finally { setBusy(''); }
  };
  const importContacts = () => {
    const sel = (contacts ?? []).filter((c) => c.sel);
    let res = { imported: 0, skipped: 0, noAddress: 0 };
    const undo = mutate((d) => { res = importRows(d, [['שם', 'טלפון'], ...sel.map((c) => [c.name, c.phone])], { name: 0, phone: 1 }); });
    toast(`יובאו ${res.imported} אנשי קשר`, undo);
    setContacts(null);
  };

  const famCount = listFamilies(db).filter((f) => displayName(f.apt)).length;
  return (
    <div className="set-grid">
      <section className="panel set-card">
        <h2>ייבוא מקובץ</h2>
        <p className="sheet-hint">קובץ CSV מאקסל או מגוגל שיטס (בשמירה: CSV UTF-8). משפחות שכבר קיימות, לפי טלפון או לפי שם וכתובת, מדולגות.</p>
        <label className="btn file-btn"><Icon name="plus" size={16} />בחירת קובץ<input type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} /></label>
      </section>
      <section className="panel set-card">
        <h2>ייבוא מגוגל שיטס</h2>
        <p className="sheet-hint">הדבק קישור לגיליון. אם הגיליון לא שלך — צריך לשתף אותו "לכל מי שיש לו את הקישור".</p>
        <form className="fc-add" onSubmit={(e) => { e.preventDefault(); void fetchSheet(); }}>
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" dir="ltr" aria-label="קישור לגיליון" />
          <button className="btn" disabled={!sheetUrl.trim() || busy === 'sheet'}>{busy === 'sheet' ? 'קורא…' : 'קריאת הגיליון'}</button>
        </form>
      </section>
      <section className="panel set-card">
        <h2>אנשי קשר מגוגל</h2>
        <p className="sheet-hint">מציג אנשי קשר מהטלפון שעוד לא במערכת, ואתה בוחר את מי להוסיף. גם משלים טלפונים ומיילים חסרים למשפחות שכבר קיימות.</p>
        <button className="btn" disabled={busy === 'contacts'} onClick={() => void scanContacts()}>{busy === 'contacts' ? 'סורק…' : 'סריקת אנשי קשר'}</button>
      </section>
      <section className="panel set-card">
        <h2>גיבוי</h2>
        <p className="sheet-hint">הנתונים נשמרים אוטומטית בגוגל דרייב שלך. כאן אפשר להוריד עותק נוסף ({famCount} משפחות), או לשלב גיבוי קודם.</p>
        <div className="fix-acts">
          <button className="btn" onClick={backup}>הורדת גיבוי</button>
          <label className="btn file-btn">שחזור מגיבוי<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} /></label>
        </div>
      </section>

      {rows && (
        <Dialog title={`ייבוא ${rows.length - 1} שורות`} onClose={() => setRows(null)}>
          <p className="dialog-note">בדוק שכל עמודה מחוברת לשדה הנכון. זיהיתי אוטומטית לפי הכותרות.</p>
          <div className="map-grid">
            {IMPORT_FIELDS.map((f) => (
              <label className="fld" key={f.key}><span>{f.label}</span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  <option value="">לא לייבא</option>
                  {rows[0]!.map((h, i) => <option key={i} value={i}>{h || `עמודה ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="preview-tbl">
            <table><tbody>{rows.slice(1, 4).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="dialog-acts"><button className="btn" onClick={() => setRows(null)}>ביטול</button>
            <button className="btn btn-primary" disabled={mapping.name === undefined && mapping.father === undefined} onClick={runImport}>ייבוא</button></div>
        </Dialog>
      )}
      {fills && (
        <Dialog title={`השלמת פרטים · ${fills.length}`} onClose={() => setFills(null)}>
          <p className="dialog-note">נמצאו באנשי הקשר פרטים שחסרים בכרטיסי המשפחות. סמן מה להשלים.</p>
          <ul className="aud-list">
            {fills.map((f, i) => (
              <li key={i}><label className="chk-row"><input type="checkbox" checked={f.sel} onChange={() => setFills((arr) => arr!.map((x, j) => (j === i ? { ...x, sel: !x.sel } : x)))} />{f.name} · {f.label}</label><span className="meta" dir="ltr">{f.value}</span></li>
            ))}
          </ul>
          <div className="dialog-acts"><button className="btn" onClick={() => setFills(null)}>ביטול</button>
            <button className="btn btn-primary" disabled={!fills.some((f) => f.sel)} onClick={() => {
              const sel = fills.filter((f) => f.sel);
              const undo = mutate((d) => { for (const f of sel) updateFamily(d, f.ref, { [f.field]: f.value }); });
              toast(`הושלמו ${sel.length} פרטים`, undo);
              setFills(null);
            }}>השלמה</button></div>
        </Dialog>
      )}
      {contacts && contacts.length > 0 && (
        <Dialog title={`${contacts.length} אנשי קשר שעוד לא במערכת`} onClose={() => setContacts(null)}>
          <div className="aud-acts"><button className="link" onClick={() => setContacts((c) => c!.map((x) => ({ ...x, sel: true })))}>בחירת הכל</button></div>
          <ul className="aud-list">
            {contacts.map((c, i) => (
              <li key={i}><label className="chk-row"><input type="checkbox" checked={c.sel} onChange={() => setContacts((arr) => arr!.map((x, j) => (j === i ? { ...x, sel: !x.sel } : x)))} />{c.name}</label><span className="meta" dir="ltr">{c.phone}</span></li>
            ))}
          </ul>
          <div className="dialog-acts"><button className="btn" onClick={() => setContacts(null)}>ביטול</button><button className="btn btn-primary" disabled={!contacts.some((c) => c.sel)} onClick={importContacts}>ייבוא הנבחרים</button></div>
        </Dialog>
      )}
    </div>
  );
}

