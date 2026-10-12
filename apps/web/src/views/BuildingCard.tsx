import { useState } from 'react';
import {
  type Apartment, type Db, type GisInfo, displayName, getBuilding, getCategories, getStatusColor,
  lastContact, linkBuilding, preferredAddress, setVerifiedUnits, statusSeverity,
} from '@shlichus/core';
import { Icon } from '../icons';
import { type ContactType, useStore } from '../store';
import { useToast } from '../ui';
import { type BuildingView, readPalette } from '../map/features';

const METHOD_TEXT: Record<string, string> = {
  address: 'כתובת מאומתת מול הרישום הרשמי',
  geocode: 'כניסה מאומתת מול GovMap',
  manual: 'שויך ידנית',
  point: 'שויך לפי מיקום בלבד',
};

export function BuildingCard({ db, view, orphanKey, onClose, onPick, onSelectKey }: {
  db: Db; view: BuildingView | null; orphanKey?: string; onClose: () => void; onPick: (key: string) => void; onSelectKey: (key: string) => void;
}) {
  if (!view) {
    // כתובת ב-CRM בלי מבנה
    const entry = orphanKey ? getBuilding(db, orphanKey) : undefined;
    return (
      <aside className="sheet" aria-label="כרטיס בניין">
        <Head title={orphanKey ?? ''} sub="לא נמצא מבנה במקום השמור" onClose={onClose} />
        <p className="sheet-note">הכתובת שמורה אצלך, אבל במקום שלה אין בניין ברישום. בחר את הבניין הנכון במפה והמשפחות יעברו איתו.</p>
        <button className="btn btn-primary" onClick={() => onPick(orphanKey!)}>בחירת הבניין במפה</button>
        {entry && <Families db={db} rows={entry.apts.map((apt, idx) => ({ key: orphanKey!, apt, idx })).filter((r) => !r.apt.deletedAt && displayName(r.apt))} />}
      </aside>
    );
  }
  return <Card db={db} view={view} onClose={onClose} onPick={onPick} onSelectKey={onSelectKey} />;
}

function Card({ db, view, onClose, onPick, onSelectKey }: {
  db: Db; view: BuildingView; onClose: () => void; onPick: (key: string) => void; onSelectKey: (key: string) => void;
}) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [adding, setAdding] = useState(false);
  const { b, keys } = view;
  const title = keys[0] ?? preferredAddress(db, b);
  const info = keys[0] ? getBuilding(db, keys[0])?.info : undefined;
  const gis = info?.gis as GisInfo | undefined;
  const cats = getCategories(db);
  const cat = cats.find((c) => c.id === view.category);
  const apts = view.apts;
  const fams = view.families.length;
  const cover = apts ? Math.min(100, Math.round((fams / apts) * 100)) : null;

  /** כתובת לכתיבה: הקיימת, או בניין חדש בשם המקובל אצל המשתמש — מקושר מיד למבנה */
  const ensureKey = (d: Db): string => {
    if (keys[0]) return keys[0];
    const key = preferredAddress(d, b);
    if (!getBuilding(d, key) || getBuilding(d, key)!.info.movedTo) d[key] = { info: { code: '', rep: '', notes: '' }, apts: [] };
    linkBuilding(d, key, b, 'address', { units: b.apts ?? undefined });
    return key;
  };

  const setCategory = (id: string) => {
    const name = cats.find((c) => c.id === id)?.name ?? '';
    const undo = mutate((d) => {
      const list = keys.length ? keys : [ensureKey(d)];
      for (const k of list) {
        const e = getBuilding(d, k)!;
        e.info = { ...e.info, category: id, updatedAt: Date.now() };
      }
    });
    toast(`סומן כ${name}`, undo);
  };

  return (
    <aside className="sheet" aria-label="כרטיס בניין">
      {/* הכותרת היא תמיד הכתובת שלך — המספר שעל השלט */}
      <Head title={title} sub="" onClose={onClose} />
      {(view.siblings.length > 0 || keys.length > 1) && (
        <div className="siblings">
          <span>{view.siblings.length ? 'כניסות נוספות בבניין:' : 'כתובות נוספות בבניין:'}</span>
          {(view.siblings.length ? view.siblings : keys.slice(1)).map((k) => (
            <button key={k} className="chip-f" onClick={() => onSelectKey(k)}>{k}</button>
          ))}
        </div>
      )}

      <div className="tags-row">
        <span className={`pill ${view.inTerritory ? 'in' : 'out'}`}>{view.inTerritory ? 'בתוך התיחום' : 'מחוץ לתיחום'}</span>
        {b.use && <span className="pill">{b.use}</span>}
        {gis?.method && <span className={`pill ${gis.method === 'point' ? 'warn' : 'ok'}`}>{METHOD_TEXT[gis.method]}</span>}
        {!keys.length && <span className="pill">אין עדיין משפחות מוכרות</span>}
      </div>

      <section className="facts" aria-label="נתוני הבניין">
        <AptsFact view={view} editable={keys.length <= 1} onSave={(n) => {
          const undo = mutate((d) => { setVerifiedUnits(d, ensureKey(d), n); });
          toast(`נשמר: ${n} דירות`, undo);
        }} />
        <Fact n={b.floors ?? '—'} l="קומות" />
        <Fact n={b.entrances ?? (keys.length || '—')} l="כניסות בבניין" />
        <Fact n={fams} l="משפחות מוכרות" />
        <div className="ring" style={{ ['--p' as string]: `${cover ?? 0}` }} aria-label={cover == null ? 'כיסוי לא ידוע' : `כיסוי ${cover}%`}>
          <span>{cover == null ? '—' : `${cover}%`}</span>
        </div>
      </section>

      <section>
        <h3 className="sheet-h">סוג הבניין</h3>
        <div className="cat-pick" role="radiogroup" aria-label="סוג הבניין">
          {cats.map((c) => (
            <button key={c.id} role="radio" aria-checked={cat?.id === c.id} onClick={() => setCategory(c.id)} style={{ ['--c' as string]: c.color }}>
              <i />{c.name}
            </button>
          ))}
        </div>
      </section>

      {(apts || fams > 0) && <FloorDiagram db={db} view={view} />}

      <section>
        <div className="sheet-h-row">
          <h3 className="sheet-h">משפחות <span className="num">{fams}</span></h3>
          <button className="btn" onClick={() => setAdding(!adding)}><Icon name="plus" size={15} />משפחה</button>
        </div>
        {adding && (
          <AddFamily onAdd={(f) => {
            const undo = mutate((d) => {
              const key = ensureKey(d);
              getBuilding(d, key)!.apts.push({ id: `apt_${Date.now()}`, name: f.lastName, num: f.num, fatherPhone: f.phone, updatedAt: Date.now() });
            });
            setAdding(false);
            toast(`משפחת ${f.lastName} נוספה`, undo);
          }} />
        )}
        <Families db={db} rows={view.families} />
      </section>

      {keys.length > 0 && gis?.method === 'point' && (
        <p className="sheet-note">הכתובת שויכה לבניין לפי המיקום בלבד. אם זה לא הבניין הנכון, <button className="link" onClick={() => onPick(keys[0]!)}>בחר אותו במפה</button>.</p>
      )}
    </aside>
  );
}

function Head({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <header className="sheet-head">
      <div>
        <h2>{title}</h2>
        {sub && <div className="sheet-sub">{sub}</div>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="סגירה"><Icon name="x" /></button>
    </header>
  );
}

const SOURCE_TEXT = { verified: 'מאומת', city: 'לפי העירייה', estimate: 'הערכה' } as const;

/**
 * מספר הדירות + מקור המספר. לחיצה מאפשרת לתקן; מספר מתוקן מסומן "מאומת"
 * וגובר על נתוני העירייה ועל ההערכה לכניסה.
 */
function AptsFact({ view, editable, onSave }: { view: BuildingView; editable: boolean; onSave: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(view.apts ?? ''));
  const src = view.aptsSource ? SOURCE_TEXT[view.aptsSource] : 'לא ידוע';
  if (editing) {
    return (
      <form className="fact fact-edit" onSubmit={(e) => { e.preventDefault(); const n = parseInt(val, 10); if (n > 0) { onSave(n); setEditing(false); } }}>
        <input value={val} onChange={(e) => setVal(e.target.value.replace(/D/g, ''))} inputMode="numeric" aria-label="מספר דירות" autoFocus />
        <button className="link" type="submit">שמירה</button>
      </form>
    );
  }
  const n = view.apts == null ? '—' : view.aptsSource === 'estimate' ? `~${view.apts}` : view.apts;
  return editable ? (
    <button className="fact fact-btn" onClick={() => { setVal(String(view.apts ?? '')); setEditing(true); }} title="לחץ לתיקון מספר הדירות">
      <b className="num">{n}</b><span>דירות · {src}</span><i className="fact-hint">תיקון</i>
    </button>
  ) : <Fact n={n} l={`דירות · ${src}`} />;
}

function Fact({ n, l }: { n: number | string; l: string }) {
  return <div className="fact"><b className="num">{n}</b><span>{l}</span></div>;
}

/**
 * חתך הבניין: קומה בכל שורה (העליונה למעלה), דירה בכל משבצת. משפחה עם מספר דירה
 * יושבת במשבצת שלה; צבע המשבצת = מצב הקשר.
 */
function FloorDiagram({ db, view }: { db: Db; view: BuildingView }) {
  const pal = readPalette();
  const floors = Math.max(1, view.b.floors ?? 1);
  const total = Math.max(view.apts ?? 0, view.families.length);
  // פיזור שווה של הדירות על כל הקומות (9 דירות ב-4 קומות = 3,2,2,2), מהקרקע למעלה
  const floorOf = (n: number) => Math.min(floors - 1, Math.floor(((n - 1) * floors) / Math.max(1, total)));
  const slots = new Map<number, { apt: Apartment }>();
  const loose: Apartment[] = [];
  for (const f of view.families) {
    const n = parseInt(String(f.apt.num ?? ''), 10);
    if (Number.isFinite(n) && n >= 1 && n <= total && !slots.has(n)) slots.set(n, { apt: f.apt });
    else loose.push(f.apt);
  }
  if (!view.apts && !view.b.floors) return null;
  return (
    <section>
      <h3 className="sheet-h">חתך הבניין <span className="sheet-hint">{floors} קומות · {view.apts ?? '?'} דירות</span></h3>
      <div className="floors" role="img" aria-label={`חתך הבניין: ${slots.size} דירות עם משפחה מוכרת מתוך ${total}`}>
        {Array.from({ length: floors }, (_, i) => floors - 1 - i).map((fl) => (
          <div className="floor" key={fl}>
            <span className="fl-n">{fl === 0 ? 'קרקע' : fl}</span>
            {Array.from({ length: total }, (_, j) => j + 1).filter((n) => floorOf(n) === fl).map((n) => {
              const s = slots.get(n);
              const color = s ? pal.sev[Math.max(0, statusSeverity(getStatusColor(s.apt, db.__SETTINGS__)))] : undefined;
              return (
                <span key={n} className={`apt${s ? ' known' : ''}`} style={color ? { background: color } : undefined}
                  title={s ? `דירה ${n}: ${displayName(s.apt)}` : `דירה ${n}`}>{n}</span>
              );
            })}
          </div>
        ))}
      </div>
      {loose.length > 0 && <div className="sheet-hint">בלי מספר דירה: {loose.map((a) => displayName(a)).join(', ')}</div>}
    </section>
  );
}

function Families({ db, rows }: { db: Db; rows: { key: string; apt: Apartment; idx: number }[] }) {
  const logContact = useStore((s) => s.logContact);
  const toast = useToast((s) => s.show);
  const pal = readPalette();
  if (!rows.length) return <p className="sheet-hint">עוד לא נרשמו משפחות בבניין הזה.</p>;
  const now = new Date();
  return (
    <ul className="fam-list">
      {rows.map(({ key, apt, idx }) => {
        const phone = String(apt.fatherPhone || apt.motherPhone || apt.phones || '').replace(/[^\d+]/g, '');
        const last = lastContact(apt);
        const days = last ? Math.round((now.getTime() - last.getTime()) / 86400000) : null;
        const sev = statusSeverity(getStatusColor(apt, db.__SETTINGS__));
        const log = (t: ContactType, label: string) => { const undo = logContact(key, idx, t); toast(`${label} עם ${displayName(apt)} נרשם`, undo); };
        return (
          <li key={`${key}:${idx}`}>
            <i className="dot" style={{ background: pal.sev[Math.max(0, sev)] }} />
            <div className="fam-main">
              <b>{displayName(apt)}</b>
              <span className="sheet-hint">{apt.num ? `דירה ${apt.num} · ` : ''}{days == null ? 'עוד לא היה קשר' : `קשר אחרון ${ago(days)}`}</span>
            </div>
            <div className="fam-acts">
              {phone && <a className="icon-btn" href={`https://wa.me/${phone.replace(/^0/, '972')}`} target="_blank" rel="noreferrer" aria-label="וואטסאפ"><Icon name="wa" size={17} /></a>}
              {phone && <a className="icon-btn" href={`tel:${phone}`} aria-label="שיחה"><Icon name="phone" size={17} /></a>}
              <button className="icon-btn" onClick={() => log('visit', 'ביקור')} aria-label="רישום ביקור"><Icon name="done" size={17} /></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ago(days: number): string {
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  const m = Math.round(days / 30);
  return m < 12 ? (m === 1 ? 'לפני חודש' : `לפני ${m} חודשים`) : 'לפני יותר משנה';
}

function AddFamily({ onAdd }: { onAdd: (f: { lastName: string; num: string; phone: string }) => void }) {
  const [f, setF] = useState({ lastName: '', num: '', phone: '' });
  return (
    <form className="add-fam" onSubmit={(e) => { e.preventDefault(); if (f.lastName.trim()) onAdd({ ...f, lastName: f.lastName.trim() }); }}>
      <input placeholder="שם משפחה" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} aria-label="שם משפחה" autoFocus />
      <input placeholder="דירה" value={f.num} onChange={(e) => setF({ ...f, num: e.target.value })} aria-label="מספר דירה" inputMode="numeric" />
      <input placeholder="טלפון" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="טלפון" inputMode="tel" dir="ltr" />
      <button className="btn btn-primary" type="submit">הוספה</button>
    </form>
  );
}
