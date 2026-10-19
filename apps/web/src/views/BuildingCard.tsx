import { useState } from 'react';
import {
  type Apartment, type BuildingInfo, type Db, type GisInfo, INSTITUTION_FIELDS, SUB_CATEGORIES, displayName, getBuilding, getCategories,
  getStatusColor, labelPoint, lastContact, linkBuilding, preferredAddress, setVerifiedUnits, statusSeverity, updateFamily,
} from '@shlichus/core';
import { Icon } from '../icons';
import { type ContactType, useStore } from '../store';
import { useNav } from '../nav';
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
  const [newNum, setNewNum] = useState('');
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

  /** שמירת שדות בפרטי הבניין (קוד, נציג, הערות, כרטיס מוסד) */
  const saveInfo = (patch: Partial<BuildingInfo>, msg: string) => {
    const undo = mutate((d) => {
      const k = ensureKey(d);
      const e = getBuilding(d, k)!;
      e.info = { ...e.info, ...patch, updatedAt: Date.now() };
    });
    toast(msg, undo);
  };
  const [lng, lat] = labelPoint(view.polygon);
  const isInstitution = !!cat && cat.id !== 'residential' && cat.id !== 'irrelevant' && cat.hasCard !== false;

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

      <div className="nav-row">
        <a className="btn" href={`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`} target="_blank" rel="noreferrer"><Icon name="nav" size={15} />ניווט ב-Waze</a>
        <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noreferrer"><Icon name="map" size={15} />גוגל מפות</a>
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

      {isInstitution && <InstitutionSection key={`inst-${title}`} info={info} catId={cat!.id} onSave={(p) => saveInfo(p, 'כרטיס המוסד נשמר')} />}

      <BuildingDetails key={`bd-${title}`} info={info} onSave={(p) => saveInfo(p, 'פרטי הבניין נשמרו')} />

      {(apts || fams > 0) && <FloorDiagram db={db} view={view}
        onAssign={(f, n) => {
          const undo = mutate((d) => updateFamily(d, { bldg: f.key, idx: f.idx }, { num: String(n) }));
          toast(`${displayName(f.apt)} שובצה בדירה ${n}`, undo);
        }}
        onNew={(n) => { setNewNum(String(n)); setAdding(true); }} />}

      <section>
        <div className="sheet-h-row">
          <h3 className="sheet-h">משפחות <span className="num">{fams}</span></h3>
          <button className="btn" onClick={() => { setNewNum(''); setAdding(!adding); }}><Icon name="plus" size={15} />משפחה</button>
        </div>
        {adding && (
          <AddFamily key={newNum} initialNum={newNum} onAdd={(f) => {
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
        <input value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="מספר דירות" autoFocus />
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
type FamRow = { key: string; apt: Apartment; idx: number };
function FloorDiagram({ db, view, onAssign, onNew }: { db: Db; view: BuildingView; onAssign: (f: FamRow, n: number) => void; onNew: (n: number) => void }) {
  const [slot, setSlot] = useState<number | null>(null);
  const pal = readPalette();
  const floors = Math.max(1, view.b.floors ?? 1);
  const total = Math.max(view.apts ?? 0, view.families.length);
  // פיזור שווה של הדירות על כל הקומות (9 דירות ב-4 קומות = 3,2,2,2), מהקרקע למעלה
  const floorOf = (n: number) => Math.min(floors - 1, Math.floor(((n - 1) * floors) / Math.max(1, total)));
  const slots = new Map<number, FamRow>();
  const loose: FamRow[] = [];
  for (const f of view.families) {
    const n = parseInt(String(f.apt.num ?? ''), 10);
    if (Number.isFinite(n) && n >= 1 && n <= total && !slots.has(n)) slots.set(n, f);
    else loose.push(f);
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
                <button key={n} className={`apt${s ? ' known' : ''}${slot === n ? ' picked' : ''}`} style={color ? { background: color } : undefined}
                  title={s ? `דירה ${n}: ${displayName(s.apt)}` : `דירה ${n} — לחץ לשיבוץ משפחה`}
                  onClick={() => (s ? useNav.getState().openFamily({ bldg: s.key, idx: s.idx }) : setSlot(slot === n ? null : n))}>{n}</button>
              );
            })}
          </div>
        ))}
      </div>
      {slot != null && (
        <div className="slot-pick" role="dialog" aria-label={`שיבוץ לדירה ${slot}`}>
          <b>דירה {slot}</b>
          {loose.map((f) => <button key={`${f.key}:${f.idx}`} className="chip-f" onClick={() => { onAssign(f, slot); setSlot(null); }}>{displayName(f.apt)}</button>)}
          <button className="chip-f" onClick={() => { onNew(slot); setSlot(null); }}>+ משפחה חדשה</button>
          <button className="link" onClick={() => setSlot(null)}>ביטול</button>
        </div>
      )}
      {loose.length > 0 && <div className="sheet-hint">בלי מספר דירה: {loose.map((f) => displayName(f.apt)).join(', ')} · לחץ על משבצת ריקה כדי לשבץ</div>}
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
              <button className="link fam-open" onClick={() => useNav.getState().openFamily({ bldg: key, idx })}>{displayName(apt)}</button>
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

function AddFamily({ onAdd, initialNum = '' }: { onAdd: (f: { lastName: string; num: string; phone: string }) => void; initialNum?: string }) {
  const [f, setF] = useState({ lastName: '', num: initialNum, phone: '' });
  return (
    <form className="add-fam" onSubmit={(e) => { e.preventDefault(); if (f.lastName.trim()) onAdd({ ...f, lastName: f.lastName.trim() }); }}>
      <input placeholder="שם משפחה" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} aria-label="שם משפחה" autoFocus />
      <input placeholder="דירה" value={f.num} onChange={(e) => setF({ ...f, num: e.target.value })} aria-label="מספר דירה" inputMode="numeric" />
      <input placeholder="טלפון" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="טלפון" inputMode="tel" dir="ltr" />
      <button className="btn btn-primary" type="submit">הוספה</button>
    </form>
  );
}

/** פרטי הבניין — כמו בכרטיס הבניין במערכת הקיימת: קוד כניסה, נציג ועד, הערות */
function BuildingDetails({ info, onSave }: { info?: BuildingInfo; onSave: (p: Partial<BuildingInfo>) => void }) {
  const init = { code: String(info?.code ?? ''), rep: String(info?.rep ?? ''), notes: String(info?.notes ?? '') };
  const [f, setF] = useState(init);
  const [open, setOpen] = useState(false);
  const dirty = f.code !== init.code || f.rep !== init.rep || f.notes !== init.notes;
  const has = init.code || init.rep || init.notes;
  if (!open) {
    return (
      <section className="bd">
        <div className="sheet-h-row"><h3 className="sheet-h">פרטי הבניין</h3><button className="link" onClick={() => setOpen(true)}>{has ? 'עריכה' : 'הוספה'}</button></div>
        {has ? (
          <dl className="bd-list">
            {init.code && <><dt>קוד כניסה</dt><dd dir="ltr">{init.code}</dd></>}
            {init.rep && <><dt>נציג ועד</dt><dd>{init.rep}</dd></>}
            {init.notes && <><dt>הערות</dt><dd>{init.notes}</dd></>}
          </dl>
        ) : <p className="sheet-hint">קוד כניסה, נציג ועד והערות.</p>}
      </section>
    );
  }
  return (
    <form className="bd bd-form" onSubmit={(e) => { e.preventDefault(); onSave(f); setOpen(false); }}>
      <h3 className="sheet-h">פרטי הבניין</h3>
      <label className="fld"><span>קוד כניסה</span><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} dir="ltr" /></label>
      <label className="fld"><span>נציג ועד</span><input value={f.rep} onChange={(e) => setF({ ...f, rep: e.target.value })} /></label>
      <label className="fld"><span>הערות</span><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div className="dialog-acts"><button type="button" className="btn" onClick={() => { setF(init); setOpen(false); }}>ביטול</button><button className="btn btn-primary" disabled={!dirty}>שמירה</button></div>
    </form>
  );
}

/** כרטיס מוסד לבניין שאינו מגורים — אותם שדות כמו openInstitutionCard במערכת הקיימת */
function InstitutionSection({ info, catId, onSave }: { info?: BuildingInfo; catId: string; onSave: (p: Partial<BuildingInfo>) => void }) {
  const fields = INSTITUTION_FIELDS[catId] ?? [];
  const subs = SUB_CATEGORIES[catId] ?? [];
  const data0 = (info?.institutionData ?? {}) as Record<string, string>;
  const [name, setName] = useState(String(info?.institutionName ?? ''));
  const [sub, setSub] = useState(String(info?.subCategoryId ?? ''));
  const [data, setData] = useState<Record<string, string>>({ ...data0 });
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  return (
    <form className="bd bd-form inst" onSubmit={(e) => { e.preventDefault(); onSave({ institutionName: name.trim(), subCategoryId: sub, institutionData: data }); setDirty(false); }}>
      <h3 className="sheet-h">כרטיס מוסד</h3>
      <label className="fld"><span>שם המוסד</span><input value={name} onChange={(e) => { setName(e.target.value); touch(); }} /></label>
      {subs.length > 0 && (
        <label className="fld"><span>סוג</span>
          <select value={sub} onChange={(e) => { setSub(e.target.value); touch(); }}><option value="" />{subs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
      )}
      {fields.map((f) => (
        <label key={f.id} className="fld"><span>{f.label}</span>
          {f.type === 'textarea'
            ? <textarea rows={2} value={data[f.id] ?? ''} onChange={(e) => { setData({ ...data, [f.id]: e.target.value }); touch(); }} />
            : <input value={data[f.id] ?? ''} onChange={(e) => { setData({ ...data, [f.id]: e.target.value }); touch(); }} dir={f.type === 'phone' || f.type === 'url' ? 'ltr' : undefined} inputMode={f.type === 'phone' ? 'tel' : undefined} />}
        </label>
      ))}
      {(data.phone || data.website) && (
        <div className="nav-row">
          {data.phone && <a className="btn" href={`tel:${data.phone}`}><Icon name="phone" size={15} />חיוג</a>}
          {data.website && <a className="btn" href={/^https?:/.test(data.website) ? data.website : `https://${data.website}`} target="_blank" rel="noreferrer">אתר</a>}
        </div>
      )}
      <div className="dialog-acts"><button className="btn btn-primary" disabled={!dirty}>שמירה</button></div>
    </form>
  );
}
