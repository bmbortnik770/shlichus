import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Apartment, type Db, type FamilyRef, type FamilyRow, type SmartView, MISSING_FIELDS, NO_ADDRESS_KEY, SMART_RULES,
  addFamily, deleteFamily, displayName, familyAddress, familyPhones, getBuilding, getInteractionTypes, getStatusColor,
  lastContact, listFamilies, logTypeKey, matchSmartView, missingAny, statusSeverity, updateFamily, waLink,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useConfirm, useCopy, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import { useNav } from '../nav';
import '../community.css';

type Status = 'all' | 'attention' | 'drifting' | 'ok' | 'never' | 'noaddr';
type SortKey = 'name' | 'address' | 'contact' | 'last_call' | 'last_visit' | `col:${string}`;
type Density = 'compact' | 'normal' | 'comfortable';

/** חומרה → קבוצה: 0 אין קשר, 1 בקשר, 2 מתרחקים, 3 צריך תשומת לב */
const SEV_STATUS: Status[] = ['never', 'ok', 'drifting', 'attention'];
const STATUS_TABS: { key: Status; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'attention', label: 'צריך תשומת לב' },
  { key: 'drifting', label: 'מתרחקים' },
  { key: 'ok', label: 'בקשר' },
  { key: 'never', label: 'עוד לא היה קשר' },
  { key: 'noaddr', label: 'ללא כתובת' },
];
const SEV_CLASS = ['cold', 'ok', 'warm', 'hot'];
const DENSITY: { key: Density; label: string }[] = [{ key: 'compact', label: 'צפוף' }, { key: 'normal', label: 'רגיל' }, { key: 'comfortable', label: 'מרווח' }];

/** עמודות — אותם מזהים כמו בגרסה הקיימת, כך שהבחירה נשמרת בין הגרסאות */
const COLS = [
  { id: 'address', label: 'כתובת' }, { id: 'name', label: 'משפחה' }, { id: 'father', label: 'שם האב' },
  { id: 'mother', label: 'שם האם' }, { id: 'phone', label: 'טלפונים' }, { id: 'email', label: 'מיילים' },
  { id: 'style', label: 'סגנון' }, { id: 'boards', label: 'פרויקטים' }, { id: 'tags', label: 'תגיות' },
  { id: 'children', label: 'ילדים' }, { id: 'notes', label: 'הערות' }, { id: 'lastContact', label: 'קשר אחרון' },
  { id: 'actions', label: 'פעולות' },
] as const;
const DEFAULT_COLS = ['address', 'name', 'phone', 'tags', 'lastContact', 'actions'];

const DAY = 86400000;
const keyOf = (r: FamilyRef) => `${r.bldg}|${r.idx}`;

export function agoText(d: Date | null): string {
  if (!d) return 'עוד לא היה קשר';
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  const m = Math.round(days / 30);
  return m < 12 ? (m === 1 ? 'לפני חודש' : `לפני ${m} חודשים`) : 'לפני יותר משנה';
}

/** התאריך האחרון של סוג פעילות (ביקור/שיחה) — מזהה גם רישומים ישנים וגם סוגים חדשים */
function latestOfType(a: Apartment, key: 'visit' | 'call'): number {
  let max = 0;
  for (const l of a.interactions ?? []) {
    if (logTypeKey(l) !== key) continue;
    const t = new Date(String(l.date)).getTime();
    if (t > max) max = t;
  }
  return max;
}

/** יעד (כמו updateGoalTracker בישן): כמה משפחות מתאימות לטקסט — רחוב, שם או תגית */
export function goalCount(db: Db, text: string): number {
  const q = text.trim().toLowerCase();
  if (!q) return 0;
  return listFamilies(db).filter((r) => `${r.bldg} ${r.apt.name ?? ''} ${(r.apt.tags ?? []).join(' ')}`.toLowerCase().includes(q)).length;
}

export function Community({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const updateSettings = useStore((s) => s.updateSettings);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const settings = db.__SETTINGS__ ?? {};

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [style, setStyle] = useState('');
  const [tag, setTag] = useState('');
  const [smart, setSmart] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [open, setOpen] = useState<FamilyRef | null>(null);
  const [bulk, setBulk] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<'cols' | 'missing' | null>(null);
  const [dlg, setDlg] = useState<'views' | 'goal' | 'phones' | null>(null);
  useEffect(() => {
    if (!pop) return;
    const off = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.cols-wrap')) setPop(null); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [pop]);

  const styles = (settings.styles ?? []) as string[];
  const tags = (settings.tags ?? []) as string[];
  const customFields = (settings.customFields ?? []) as string[];
  const smartViews = (settings.smartViews ?? []) as SmartView[];
  const boards = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  const boardsById = new Map((db.__BOARDS__ ?? []).map((b) => [b.id, b.name]));
  const visible = (settings.visibleColumns as string[] | undefined) ?? DEFAULT_COLS;
  const cols = COLS.filter((c) => visible.includes(c.id));
  const density = ((settings.tableDensity as Density | undefined) ?? 'normal');
  const goal = settings.goal as { text?: string; target?: number } | undefined;

  const rows = useMemo(() => listFamilies(db).filter((r) => displayName(r.apt) || r.apt.num), [db]);
  const sevOf = useMemo(() => new Map(rows.map((r) => [keyOf(r), statusSeverity(getStatusColor(r.apt, settings))])), [rows, settings]);
  const statusOf = (r: FamilyRow): Status => SEV_STATUS[sevOf.get(keyOf(r)) ?? 0]!;

  const counts = useMemo(() => {
    const c: Record<Status, number> = { all: rows.length, attention: 0, drifting: 0, ok: 0, never: 0, noaddr: 0 };
    for (const r of rows) { c[statusOf(r)]++; if (r.bldg === NO_ADDRESS_KEY) c.noaddr++; }
    return c;
  }, [rows, sevOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (r: FamilyRow, id: string): string => {
    const a = r.apt;
    switch (id) {
      case 'address': return familyAddress(r.bldg, a);
      case 'father': return a.father ?? '';
      case 'mother': return a.mother ?? '';
      case 'phone': return familyPhones(a).join(' · ');
      case 'email': return [a.fatherEmail, a.motherEmail].filter(Boolean).join(' · ');
      case 'style': return a.style ?? '';
      case 'boards': return Object.keys(a.boards ?? {}).map((id2) => boardsById.get(id2) ?? '').filter(Boolean).join(' · ');
      case 'tags': return (a.tags ?? []).join(' · ');
      case 'children': return String((a.childrenList ?? []).length || '');
      case 'notes': return String(a.notes ?? '').slice(0, 60);
      case 'lastContact': return agoText(lastContact(a));
      default: return displayName(a);
    }
  };

  const filtered = useMemo(() => {
    const term = q.trim().replace(/-/g, '');
    const view = smartViews.find((v) => v.id === smart);
    const out = rows.filter((r) => {
      const a = r.apt;
      if (status === 'noaddr' ? r.bldg !== NO_ADDRESS_KEY : status !== 'all' && statusOf(r) !== status) return false;
      if (style && a.style !== style) return false;
      if (tag && !(a.tags ?? []).includes(tag)) return false;
      if (view && !matchSmartView(a, view)) return false;
      if (missing.length && !missingAny(a, r.bldg, missing)) return false;
      if (!term) return true;
      const hay = [a.name, a.father, a.mother, r.bldg, a.num, a.style, ...(a.tags ?? []), ...familyPhones(a), a.fatherEmail, a.motherEmail].join(' ').replace(/-/g, '');
      return hay.includes(term);
    });
    const name = (r: FamilyRow) => displayName(r.apt);
    const byAddr = (x: FamilyRow, y: FamilyRow) => (x.bldg === NO_ADDRESS_KEY ? 1 : 0) - (y.bldg === NO_ADDRESS_KEY ? 1 : 0) || x.bldg.localeCompare(y.bldg, 'he', { numeric: true }) || String(x.apt.num ?? '').localeCompare(String(y.apt.num ?? ''), 'he', { numeric: true });
    const byContact = (x: FamilyRow, y: FamilyRow) => (lastContact(x.apt)?.getTime() ?? 0) - (lastContact(y.apt)?.getTime() ?? 0);
    let cmp: (x: FamilyRow, y: FamilyRow) => number;
    if (sort === 'name') cmp = (x, y) => name(x).localeCompare(name(y), 'he');
    else if (sort === 'address') cmp = byAddr;
    // קודם מי שהכי מזמן לא היה איתו קשר
    else if (sort === 'contact') cmp = byContact;
    else if (sort === 'last_call') cmp = (x, y) => latestOfType(y.apt, 'call') - latestOfType(x.apt, 'call');
    else if (sort === 'last_visit') cmp = (x, y) => latestOfType(y.apt, 'visit') - latestOfType(x.apt, 'visit');
    else {
      const id = sort.slice(4);
      cmp = id === 'address' ? byAddr : id === 'lastContact' ? byContact
        : id === 'children' ? (x, y) => (x.apt.childrenList ?? []).length - (y.apt.childrenList ?? []).length
        : (x, y) => (cell(x, id) ? 0 : 1) - (cell(y, id) ? 0 : 1) || cell(x, id).localeCompare(cell(y, id), 'he', { numeric: true });
    }
    out.sort(cmp);
    return desc ? out.reverse() : out;
  }, [rows, q, status, style, tag, smart, missing, sort, desc, smartViews]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortBy = (id: string) => {
    const k = `col:${id}` as SortKey;
    if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); }
  };

  const newFamily = () => {
    let ref: FamilyRef | null = null;
    mutate((d) => { ref = addFamily(d, ''); });
    if (ref) setOpen(ref);
  };

  const exportCsv = () => {
    const shown = cols.filter((c) => c.id !== 'actions');
    const lines = [shown.map((c) => c.label), ...filtered.map((r) => shown.map((c) => cell(r, c.id)))]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `קהילה-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const bulkRefs = () => [...bulk].map((k) => { const i = k.lastIndexOf('|'); return { bldg: k.slice(0, i), idx: Number(k.slice(i + 1)) }; });
  const bulkRows = () => bulkRefs().map((r) => ({ ...r, apt: getBuilding(db, r.bldg)?.apts[r.idx] })).filter((r): r is FamilyRow => !!r.apt);
  const bulkTag = (t: string) => {
    const undo = mutate((d) => {
      for (const ref of bulkRefs()) {
        const a = getBuilding(d, ref.bldg)?.apts[ref.idx];
        if (a && !(a.tags ?? []).includes(t)) updateFamily(d, ref, { tags: [...(a.tags ?? []), t] });
      }
    });
    toast(`התגית "${t}" נוספה ל-${bulk.size} משפחות`, undo);
    setBulk(new Set());
  };
  const bulkBoard = (id: string) => {
    const b = boards.find((x) => x.id === id);
    if (!b) return;
    let n = 0;
    const undo = mutate((d) => {
      for (const ref of bulkRefs()) {
        const a = getBuilding(d, ref.bldg)?.apts[ref.idx];
        const cur = (a?.boards ?? {}) as Record<string, string>;
        if (a && !cur[b.id]) { updateFamily(d, ref, { boards: { ...cur, [b.id]: b.columns[0] ?? '' } }); n++; }
      }
    });
    toast(`${n} משפחות צורפו ל"${b.name}"`, undo);
    setBulk(new Set());
  };
  const bulkDelete = async () => {
    if (!(await ask({ title: 'מחיקת משפחות', message: `למחוק ${bulk.size} משפחות? אפשר לבטל מיד אחרי.`, confirm: 'מחיקה', danger: true }))) return;
    const n = bulk.size;
    const undo = mutate((d) => { for (const ref of bulkRefs()) deleteFamily(d, ref); });
    toast(`${n} משפחות נמחקו`, undo);
    setBulk(new Set());
  };
  /** מסלול בגוגל מפות — עד 10 יעדים, מהבית (כמו bulkRoute בישן) */
  const bulkRoute = () => {
    let stops = [...new Set(bulkRefs().filter((r) => r.bldg !== NO_ADDRESS_KEY).map((r) => r.bldg))];
    if (!stops.length) { toast('לא נבחרו משפחות עם כתובת'); return; }
    if (stops.length > 10) { toast('גוגל מפות מקבל עד 10 יעדים. נלקחו 10 הראשונים.'); stops = stops.slice(0, 10); }
    const city = String((settings.homeLocation as { address?: string } | undefined)?.address ?? '').split(',').pop()?.trim() ?? '';
    const enc = (s: string) => encodeURIComponent(city && !s.includes(city) ? `${s}, ${city}` : s);
    const home = (settings.homeLocation as { address?: string } | undefined)?.address;
    const origin = home ? encodeURIComponent(home) : enc(stops.shift()!);
    const dest = stops.length ? enc(stops.pop()!) : origin;
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${origin}&destination=${dest}`;
    if (stops.length) url += `&waypoints=${stops.map(enc).join('|')}`;
    window.open(url, '_blank', 'noopener');
  };
  const toggle = (k: string) => setBulk((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const removeOne = async (r: FamilyRow) => {
    const name = displayName(r.apt) || 'המשפחה';
    if (!(await ask({ title: 'מחיקת משפחה', message: `למחוק את ${name}? אפשר לבטל מיד אחרי.`, confirm: 'מחיקה', danger: true }))) return;
    const undo = mutate((d) => deleteFamily(d, r));
    toast(`${name} נמחקה`, undo);
  };

  const goalN = goal?.text ? goalCount(db, goal.text) : 0;
  const goalPct = goal?.target ? Math.min(100, Math.round((goalN / goal.target) * 100)) : 0;
  const missingLabel = (k: string) => (k.startsWith('custom_') ? k.slice(7) : MISSING_FIELDS.find((m) => m.key === k)?.label ?? k);

  return (
    <>
      <section className="hello">
        <div>
          <h1>הקהילה</h1>
          <p className="lede">
            <b className="num">{counts.all}</b> משפחות
            {counts.attention > 0 && <> · <b className="num">{counts.attention}</b> צריכות תשומת לב</>}
            {counts.noaddr > 0 && <> · <button className="link" onClick={() => setStatus('noaddr')}><span className="num">{counts.noaddr}</span> בלי כתובת</button></>}
          </p>
        </div>
        <div className="hello-acts">
          <button className="btn" onClick={exportCsv}><Icon name="copy" size={16} /><span className="lbl-wide">ייצוא לאקסל</span></button>
          <button className="btn btn-primary" onClick={newFamily}><Icon name="plus" size={16} />משפחה חדשה</button>
        </div>
      </section>

      <button className={`goal ${goal?.text ? '' : 'goal-empty'}`} onClick={() => setDlg('goal')} title="עריכת היעד">
        {goal?.text ? (
          <>
            <span className="goal-t">יעד: <b>{goal.target}</b> משפחות · {goal.text}</span>
            <span className="goal-n"><b className="num">{goalN}</b> מתוך {goal.target} ({goalPct}%)</span>
            <span className="pbar goal-bar"><i style={{ width: `${goalPct}%` }} /></span>
          </>
        ) : <span className="goal-t"><Icon name="plus" size={14} /> הגדרת יעד (למשל: 30 משפחות ברחוב מסוים או עם תגית)</span>}
      </button>

      <div className="com-tabs" role="tablist" aria-label="סינון לפי מצב">
        {STATUS_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={t.key !== 'all' && t.key !== 'noaddr' ? `st-${t.key}` : ''}>
            {t.label} <span className="num">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {status === 'noaddr' && (
        <p className="com-note">משפחות בלי כתובת לא מופיעות במפה. פתח משפחה ולחץ <b>שיבוץ כתובת</b>. כתובת עם מספר בית מופיעה במפה מיד.</p>
      )}

      <div className="com-bar">
        <label className="search com-search" htmlFor="cq"><Icon name="search" size={16} />
          <input id="cq" type="search" placeholder="שם, טלפון, רחוב או תגית" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {styles.length > 0 && (
          <select className="sel" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="סגנון">
            <option value="">כל הסגנונות</option>
            {styles.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select className="sel" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="תגית">
            <option value="">כל התגיות</option>
            {tags.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <select className="sel" value={smart} onChange={(e) => { if (e.target.value === '__manage__') setDlg('views'); else setSmart(e.target.value); }} aria-label="תצוגה חכמה">
          <option value="">תצוגה חכמה</option>
          {smartViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          <option value="__manage__">ניהול תצוגות…</option>
        </select>
        <span className="cols-wrap">
          <button className={`btn ${missing.length ? 'btn-on' : ''}`} onClick={() => setPop(pop === 'missing' ? null : 'missing')} aria-expanded={pop === 'missing'}>
            חסרים פרטים{missing.length ? ` · ${missing.length}` : ''}
          </button>
          {pop === 'missing' && (
            <div className="cols-pop">
              <span className="meta">משפחות שחסר להן לפחות אחד מ:</span>
              {[...MISSING_FIELDS.map((m) => m.key as string), ...customFields.map((c) => `custom_${c}`)].map((k) => (
                <label key={k}><input type="checkbox" checked={missing.includes(k)} onChange={() => setMissing((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]))} />{missingLabel(k)}</label>
              ))}
              {missing.length > 0 && <button className="link" onClick={() => setMissing([])}>ניקוי</button>}
            </div>
          )}
        </span>
        <select className="sel" value={sort.startsWith('col:') ? '' : sort} onChange={(e) => { setSort(e.target.value as SortKey); setDesc(false); }} aria-label="מיון">
          {sort.startsWith('col:') && <option value="">מיון: {COLS.find((c) => c.id === sort.slice(4))?.label}</option>}
          <option value="name">מיון: שם</option>
          <option value="address">מיון: כתובת</option>
          <option value="contact">מיון: הכי מזמן בלי קשר</option>
          <option value="last_call">מיון: שיחה אחרונה</option>
          <option value="last_visit">מיון: ביקור אחרון</option>
        </select>
        <span className="cols-wrap">
          <button className="btn" onClick={() => setPop(pop === 'cols' ? null : 'cols')} aria-expanded={pop === 'cols'}>תצוגה</button>
          {pop === 'cols' && (
            <div className="cols-pop">
              <span className="meta">עמודות</span>
              {COLS.map((c) => (
                <label key={c.id}><input type="checkbox" checked={visible.includes(c.id)}
                  onChange={() => void updateSettings({ visibleColumns: visible.includes(c.id) ? visible.filter((x) => x !== c.id) : [...visible, c.id] })} />{c.label}</label>
              ))}
              <span className="meta">צפיפות</span>
              <div className="seg-s" role="group" aria-label="צפיפות">
                {DENSITY.map((d) => <button key={d.key} aria-pressed={density === d.key} onClick={() => void updateSettings({ tableDensity: d.key })}>{d.label}</button>)}
              </div>
            </div>
          )}
        </span>
      </div>

      {(smart || missing.length > 0) && (
        <div className="com-active">
          {smart && <span className="pill pill-accent">{smartViews.find((v) => v.id === smart)?.name}<button className="ib-s" aria-label="הסרת תצוגה" onClick={() => setSmart('')}>×</button></span>}
          {missing.length > 0 && <span className="pill pill-accent">חסר: {missing.map(missingLabel).join(' / ')}<button className="ib-s" aria-label="הסרת סינון" onClick={() => setMissing([])}>×</button></span>}
          <span className="meta">{filtered.length} משפחות</span>
        </div>
      )}

      {bulk.size > 0 && (
        <div className="bulk" role="region" aria-label="פעולות על המסומנות">
          <b>{bulk.size} מסומנות</b>
          <button className="btn" onClick={() => useNav.getState().sendTo([...bulk])}><Icon name="chat" size={15} />שליחת הודעה</button>
          <button className="btn" onClick={() => setDlg('phones')}><Icon name="phone" size={15} />רשימת טלפונים</button>
          <button className="btn" onClick={bulkRoute}><Icon name="map" size={15} />מסלול ביקורים</button>
          {tags.length > 0 && (
            <select className="sel" value="" onChange={(e) => e.target.value && bulkTag(e.target.value)} aria-label="הוספת תגית">
              <option value="">הוספת תגית…</option>
              {tags.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
          {boards.length > 0 && (
            <select className="sel" value="" onChange={(e) => e.target.value && bulkBoard(e.target.value)} aria-label="צירוף ללוח">
              <option value="">צירוף ללוח…</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="btn btn-danger" onClick={() => void bulkDelete()}>מחיקה</button>
          <button className="btn" onClick={() => setBulk(new Set())}>ניקוי</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <section className="panel empty-state">לא נמצאו משפחות{q ? ` עבור "${q}"` : ''}.</section>
      ) : (
        <>
          <div className="panel com-table-wrap">
            <table className={`com-table d-${density}`}>
              <thead>
                <tr>
                  <th className="chk"><input type="checkbox" aria-label="סימון הכל" checked={bulk.size > 0 && bulk.size === filtered.length}
                    onChange={(e) => setBulk(e.target.checked ? new Set(filtered.map(keyOf)) : new Set())} /></th>
                  {cols.map((c) => (
                    <th key={c.id} aria-sort={sort === `col:${c.id}` ? (desc ? 'descending' : 'ascending') : undefined}>
                      {c.id === 'actions' ? c.label : (
                        <button className="th-sort" onClick={() => sortBy(c.id)}>{c.label}{sort === `col:${c.id}` ? (desc ? ' ↓' : ' ↑') : ''}</button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const k = keyOf(r);
                  const sev = sevOf.get(k) ?? 0;
                  return (
                    <tr key={k} onClick={() => setOpen(r)} className={bulk.has(k) ? 'sel' : ''}>
                      <td className="chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={bulk.has(k)} onChange={() => toggle(k)} aria-label={`סימון ${displayName(r.apt)}`} /></td>
                      {cols.map((c) => (
                        <td key={c.id} className={`c-${c.id}`}>
                          {c.id === 'name' ? <span className="nm"><i className={`dot ${SEV_CLASS[sev]}`} />{displayName(r.apt) || 'ללא שם'}</span>
                            : c.id === 'tags' ? (r.apt.tags ?? []).map((t) => <span key={t} className="tg">{t}</span>)
                            : c.id === 'address' && r.bldg === NO_ADDRESS_KEY ? <span className="noaddr">ללא כתובת</span>
                            : c.id === 'address' ? <button className="link addr-link" title="הצגה במפה" onClick={(e) => { e.stopPropagation(); useNav.getState().showOnMap(r.bldg); }}>{familyAddress(r.bldg, r.apt)}</button>
                            : c.id === 'actions' ? <RowActions row={r} onOpen={() => setOpen(r)} onDelete={() => void removeOne(r)} />
                            : cell(r, c.id)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="com-cards">
            {filtered.map((r) => {
              const k = keyOf(r);
              const sev = sevOf.get(k) ?? 0;
              return (
                <li key={k} onClick={() => setOpen(r)} className={bulk.has(k) ? 'sel' : ''}>
                  <i className={`dot ${SEV_CLASS[sev]}`} />
                  <div className="cc-main">
                    <b>{displayName(r.apt) || 'ללא שם'}</b>
                    <span>{familyAddress(r.bldg, r.apt)} · {agoText(lastContact(r.apt))}</span>
                  </div>
                  <RowActions row={r} onOpen={() => setOpen(r)} onDelete={() => void removeOne(r)} onSelect={() => toggle(k)} selected={bulk.has(k)} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && getBuilding(db, open.bldg)?.apts[open.idx] && !getBuilding(db, open.bldg)!.apts[open.idx]!.deletedAt && (
        <FamilyCard db={db} fref={open} onClose={() => setOpen(null)} onMoved={setOpen} />
      )}
      {dlg === 'views' && <SmartViewsDialog db={db} views={smartViews} onClose={() => setDlg(null)}
        onSave={(next, msg) => { const undo = mutate((d) => { d.__SETTINGS__ = { ...(d.__SETTINGS__ ?? {}), smartViews: next, updatedAt: Date.now() }; }); toast(msg, undo); if (smart && !next.some((v) => v.id === smart)) setSmart(''); }}
        onApply={(id) => { setSmart(id); setDlg(null); }} />}
      {dlg === 'goal' && <GoalDialog db={db} goal={goal} onClose={() => setDlg(null)}
        onSave={(g) => { const undo = mutate((d) => { d.__SETTINGS__ = { ...(d.__SETTINGS__ ?? {}), goal: g, updatedAt: Date.now() }; }); toast('היעד עודכן', undo); setDlg(null); }} />}
      {dlg === 'phones' && <PhonesDialog rows={bulkRows()} onClose={() => setDlg(null)} />}
    </>
  );
}

/** פעולות לשורה: וואטסאפ, חיוג, מייל ותפריט (פתיחה, מפה, מחיקה) */
function RowActions({ row, onOpen, onDelete, onSelect, selected }: { row: FamilyRow; onOpen: () => void; onDelete: () => void; onSelect?: () => void; selected?: boolean }) {
  const apt = row.apt;
  const phone = familyPhones(apt)[0];
  const email = apt.fatherEmail || apt.motherEmail;
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  return (
    <span className="row-acts" ref={ref} onClick={(e) => e.stopPropagation()}>
      {phone && <a className="ib" href={waLink(phone)} target="_blank" rel="noreferrer" aria-label="וואטסאפ"><Icon name="wa" size={16} /></a>}
      {phone && <a className="ib" href={`tel:${phone}`} aria-label="שיחה"><Icon name="phone" size={16} /></a>}
      {email && <a className="ib" href={`mailto:${email}`} aria-label="מייל"><Icon name="chat" size={16} /></a>}
      <button className="ib row-more" aria-label="עוד פעולות" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
      {menu && (
        <span className="row-menu" role="menu">
          <button role="menuitem" onClick={() => { setMenu(false); onOpen(); }}>פתיחת הכרטיס</button>
          {row.bldg !== NO_ADDRESS_KEY && <button role="menuitem" onClick={() => { setMenu(false); useNav.getState().showOnMap(row.bldg); }}>הצגה במפה</button>}
          {onSelect && <button role="menuitem" onClick={() => { setMenu(false); onSelect(); }}>{selected ? 'ביטול סימון' : 'סימון'}</button>}
          <button role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}>מחיקה</button>
        </span>
      )}
    </span>
  );
}

/* ───────── תצוגות חכמות ───────── */

function SmartViewsDialog({ db, views, onClose, onSave, onApply }: {
  db: Db; views: SmartView[]; onClose: () => void; onSave: (v: SmartView[], msg: string) => void; onApply: (id: string) => void;
}) {
  const s = db.__SETTINGS__ ?? {};
  const [name, setName] = useState('');
  const [rule, setRule] = useState(SMART_RULES[0]!.rule);
  const [age, setAge] = useState('13');
  const [type, setType] = useState('כלשהו');
  const [months, setMonths] = useState('3');
  const [board, setBoard] = useState((db.__BOARDS__ ?? [])[0]?.id ?? '');
  const [tag, setTag] = useState(((s.tags ?? []) as string[])[0] ?? '');
  const def = SMART_RULES.find((r) => r.rule === rule)!;
  const types = getInteractionTypes(s);

  const build = (): SmartView => {
    const v: SmartView = { id: `sv_${Date.now()}`, name: name.trim(), rule };
    if (rule === 'child_age') v.param1 = age;
    if (rule === 'no_interaction') { v.param1 = type; v.param2 = months; }
    if (rule === 'no_visit_months' || rule === 'no_call_months') v.value = months;
    if (rule === 'in_project') v.param1 = board;
    if (rule === 'has_tag') v.value = tag;
    return v;
  };
  const preview = useMemo(() => {
    const v = build();
    return listFamilies(db).filter((r) => matchSmartView(r.apt, v)).length;
  }, [rule, age, type, months, board, tag, db]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog title="תצוגות חכמות" onClose={onClose}>
      {views.length > 0 && (
        <ul className="fc-list sv-list">
          {views.map((v) => (
            <li key={v.id}>
              <button className="link" onClick={() => onApply(v.id)}>{v.name}</button>
              <span className="meta">{SMART_RULES.find((r) => r.rule === v.rule)?.label ?? v.rule}</span>
              <button className="ib" aria-label={`מחיקת ${v.name}`} onClick={() => onSave(views.filter((x) => x.id !== v.id), `התצוגה "${v.name}" נמחקה`)}><Icon name="x" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="dlg-h">תצוגה חדשה</h3>
      <label className="fld"><span>שם</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: ילדים לפני בר מצווה" /></label>
      <label className="fld"><span>כלל</span>
        <select value={rule} onChange={(e) => setRule(e.target.value)}>{SMART_RULES.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}</select>
      </label>
      {def.params.includes('age') && <label className="fld"><span>גיל</span><input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>}
      {def.params.includes('type') && (
        <label className="fld"><span>סוג קשר</span>
          <select value={type} onChange={(e) => setType(e.target.value)}><option>כלשהו</option>{types.map((t) => <option key={t.key} value={t.label}>{t.label}</option>)}</select>
        </label>
      )}
      {def.params.includes('months') && <label className="fld"><span>חודשים</span><input value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>}
      {def.params.includes('board') && (
        <label className="fld"><span>לוח</span>
          <select value={board} onChange={(e) => setBoard(e.target.value)}>{(db.__BOARDS__ ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
      )}
      {def.params.includes('tag') && (
        <label className="fld"><span>תגית</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>{((s.tags ?? []) as string[]).map((t) => <option key={t}>{t}</option>)}</select>
        </label>
      )}
      <p className="dialog-note">מתאימות עכשיו: <b className="num">{preview}</b> משפחות</p>
      <div className="dialog-acts">
        <button className="btn" onClick={onClose}>סגירה</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => { const v = build(); onSave([...views, v], `התצוגה "${v.name}" נשמרה`); onApply(v.id); }}>שמירה והצגה</button>
      </div>
    </Dialog>
  );
}

/* ───────── יעד ───────── */

function GoalDialog({ db, goal, onClose, onSave }: { db: Db; goal?: { text?: string; target?: number }; onClose: () => void; onSave: (g: { text: string; target: number }) => void }) {
  const [text, setText] = useState(goal?.text ?? '');
  const [target, setTarget] = useState(String(goal?.target ?? 30));
  const n = goalCount(db, text);
  return (
    <Dialog title="יעד" onClose={onClose}>
      <p className="dialog-note">לאן אתה רוצה להגיע? היעד נספר לפי מילה בכתובת, בשם המשפחה או בתגית.</p>
      <label className="fld"><span>מה נספר</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="למשל: דוד ניב, או תגית 'תפילין'" /></label>
      <label className="fld"><span>כמה משפחות</span><input value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
      {text.trim() && <p className="dialog-note">כרגע: <b className="num">{n}</b> משפחות מתאימות.</p>}
      <div className="dialog-acts">
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn btn-primary" disabled={!text.trim() || !Number(target)} onClick={() => onSave({ text: text.trim(), target: Number(target) })}>שמירה</button>
      </div>
    </Dialog>
  );
}

/* ───────── רשימת טלפונים ───────── */

function PhonesDialog({ rows, onClose }: { rows: FamilyRow[]; onClose: () => void }) {
  const { copied, copy } = useCopy();
  const list = rows.map((r) => ({ name: displayName(r.apt), phones: familyPhones(r.apt) }));
  const text = list.filter((x) => x.phones.length).map((x) => `${x.name}: ${x.phones.join(', ')}`).join('\n');
  const missing = list.filter((x) => !x.phones.length).length;
  return (
    <Dialog title={`רשימת טלפונים · ${list.length}`} onClose={onClose}>
      <ul className="fc-list phones-list">
        {list.map((x, i) => (
          <li key={i}><span>{x.name}</span>{x.phones.length ? <span className="ph">{x.phones.map((p) => <a key={p} href={`tel:${p}`} dir="ltr">{p}</a>)}</span> : <span className="meta">אין טלפון</span>}</li>
        ))}
      </ul>
      {missing > 0 && <p className="dialog-note">ל-{missing} משפחות אין טלפון בכרטיס.</p>}
      <div className="dialog-acts">
        <button className="btn" onClick={onClose}>סגירה</button>
        <button className="btn btn-primary" disabled={!text} onClick={() => void copy(text)}>{copied ? 'הועתק ✓' : 'העתקת הרשימה'}</button>
      </div>
    </Dialog>
  );
}
