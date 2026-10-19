import { useMemo, useState } from 'react';
import {
  type Apartment, type Db, type FamilyRef, type FamilyRow, NO_ADDRESS_KEY, addFamily, deleteFamily,
  displayName, familyAddress, familyPhones, getBuilding, getStatusColor, lastContact, listFamilies,
  statusSeverity, updateFamily, waLink,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useConfirm, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import { useNav } from '../nav';
import '../community.css';

type Status = 'all' | 'attention' | 'drifting' | 'ok' | 'never' | 'noaddr';
type SortKey = 'name' | 'address' | 'contact' | 'last_call' | 'last_visit';

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

function latestOfType(a: Apartment, type: string): number {
  let max = 0;
  for (const l of a.interactions ?? []) {
    if (l.type !== type) continue;
    const t = new Date(String(l.date)).getTime();
    if (t > max) max = t;
  }
  return max;
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
  const [sort, setSort] = useState<SortKey>('name');
  const [open, setOpen] = useState<FamilyRef | null>(null);
  const [bulk, setBulk] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);

  const styles = (settings.styles ?? []) as string[];
  const tags = (settings.tags ?? []) as string[];
  const smartViews = (settings.smartViews ?? []) as { id: string; name: string; rule: string }[];
  const boardsById = new Map((db.__BOARDS__ ?? []).map((b) => [b.id, b.name]));
  const visible = (settings.visibleColumns as string[] | undefined) ?? DEFAULT_COLS;
  const cols = COLS.filter((c) => visible.includes(c.id));

  const rows = useMemo(() => listFamilies(db).filter((r) => displayName(r.apt) || r.apt.num), [db]);
  const sevOf = useMemo(() => new Map(rows.map((r) => [keyOf(r), statusSeverity(getStatusColor(r.apt, settings))])), [rows, settings]);
  const statusOf = (r: FamilyRow): Status => SEV_STATUS[sevOf.get(keyOf(r)) ?? 0]!;

  const counts = useMemo(() => {
    const c: Record<Status, number> = { all: rows.length, attention: 0, drifting: 0, ok: 0, never: 0, noaddr: 0 };
    for (const r of rows) { c[statusOf(r)]++; if (r.bldg === NO_ADDRESS_KEY) c.noaddr++; }
    return c;
  }, [rows, sevOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = q.trim().replace(/-/g, '');
    const rule = smartViews.find((v) => v.id === smart)?.rule;
    const out = rows.filter((r) => {
      const a = r.apt;
      if (status === 'noaddr' ? r.bldg !== NO_ADDRESS_KEY : status !== 'all' && statusOf(r) !== status) return false;
      if (style && a.style !== style) return false;
      if (tag && !(a.tags ?? []).includes(tag)) return false;
      if (rule === 'no_visit_3m') { const d = lastContact(a); if (d && Date.now() - d.getTime() <= 90 * DAY) return false; }
      if (rule === 'bday_month') {
        const m = new Date().getMonth();
        if (!(a.milestones ?? []).some((x) => String(x.type ?? '').includes('birthday') && new Date(String(x.gregDate ?? '')).getMonth() === m)) return false;
      }
      if (!term) return true;
      const hay = [a.name, a.father, a.mother, r.bldg, a.num, a.style, ...(a.tags ?? []), ...familyPhones(a), a.fatherEmail, a.motherEmail].join(' ').replace(/-/g, '');
      return hay.includes(term);
    });
    const name = (r: FamilyRow) => displayName(r.apt);
    const cmp: Record<SortKey, (x: FamilyRow, y: FamilyRow) => number> = {
      name: (x, y) => name(x).localeCompare(name(y), 'he'),
      address: (x, y) => (x.bldg === NO_ADDRESS_KEY ? 1 : 0) - (y.bldg === NO_ADDRESS_KEY ? 1 : 0) || x.bldg.localeCompare(y.bldg, 'he', { numeric: true }),
      // קודם מי שהכי מזמן לא היה איתו קשר
      contact: (x, y) => (lastContact(x.apt)?.getTime() ?? 0) - (lastContact(y.apt)?.getTime() ?? 0),
      last_call: (x, y) => latestOfType(y.apt, 'שיחה') - latestOfType(x.apt, 'שיחה'),
      last_visit: (x, y) => latestOfType(y.apt, 'ביקור') - latestOfType(x.apt, 'ביקור'),
    };
    return out.sort(cmp[sort]);
  }, [rows, q, status, style, tag, smart, sort, smartViews]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const bulkDelete = async () => {
    if (!(await ask({ title: 'מחיקת משפחות', message: `למחוק ${bulk.size} משפחות? אפשר לבטל מיד אחרי.`, confirm: 'מחיקה', danger: true }))) return;
    const n = bulk.size;
    const undo = mutate((d) => { for (const ref of bulkRefs()) deleteFamily(d, ref); });
    toast(`${n} משפחות נמחקו`, undo);
    setBulk(new Set());
  };
  const toggle = (k: string) => setBulk((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
        {smartViews.length > 0 && (
          <select className="sel" value={smart} onChange={(e) => setSmart(e.target.value)} aria-label="תצוגה חכמה">
            <option value="">תצוגה חכמה</option>
            {smartViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="מיון">
          <option value="name">מיון: שם</option>
          <option value="address">מיון: כתובת</option>
          <option value="contact">מיון: הכי מזמן בלי קשר</option>
          <option value="last_call">מיון: שיחה אחרונה</option>
          <option value="last_visit">מיון: ביקור אחרון</option>
        </select>
        <span className="cols-wrap">
          <button className="btn" onClick={() => setColsOpen(!colsOpen)} aria-expanded={colsOpen}>עמודות</button>
          {colsOpen && (
            <div className="cols-pop">
              {COLS.map((c) => (
                <label key={c.id}><input type="checkbox" checked={visible.includes(c.id)}
                  onChange={() => void updateSettings({ visibleColumns: visible.includes(c.id) ? visible.filter((x) => x !== c.id) : [...visible, c.id] })} />{c.label}</label>
              ))}
            </div>
          )}
        </span>
      </div>

      {bulk.size > 0 && (
        <div className="bulk" role="region" aria-label="פעולות על המסומנות">
          <b>{bulk.size} מסומנות</b>
          {tags.length > 0 && (
            <select className="sel" value="" onChange={(e) => e.target.value && bulkTag(e.target.value)} aria-label="הוספת תגית">
              <option value="">הוספת תגית…</option>
              {tags.map((t) => <option key={t}>{t}</option>)}
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
            <table className="com-table">
              <thead>
                <tr>
                  <th className="chk"><input type="checkbox" aria-label="סימון הכל" checked={bulk.size > 0 && bulk.size === filtered.length}
                    onChange={(e) => setBulk(e.target.checked ? new Set(filtered.map(keyOf)) : new Set())} /></th>
                  {cols.map((c) => <th key={c.id}>{c.label}</th>)}
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
                            : c.id === 'actions' ? <RowActions apt={r.apt} />
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
              const sev = sevOf.get(keyOf(r)) ?? 0;
              return (
                <li key={keyOf(r)} onClick={() => setOpen(r)}>
                  <i className={`dot ${SEV_CLASS[sev]}`} />
                  <div className="cc-main">
                    <b>{displayName(r.apt) || 'ללא שם'}</b>
                    <span>{familyAddress(r.bldg, r.apt)} · {agoText(lastContact(r.apt))}</span>
                  </div>
                  <RowActions apt={r.apt} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {open && getBuilding(db, open.bldg)?.apts[open.idx] && !getBuilding(db, open.bldg)!.apts[open.idx]!.deletedAt && (
        <FamilyCard db={db} fref={open} onClose={() => setOpen(null)} onMoved={setOpen} />
      )}
    </>
  );
}

function RowActions({ apt }: { apt: Apartment }) {
  const phone = familyPhones(apt)[0];
  const email = apt.fatherEmail || apt.motherEmail;
  if (!phone && !email) return null;
  return (
    <span className="row-acts" onClick={(e) => e.stopPropagation()}>
      {phone && <a className="ib" href={waLink(phone)} target="_blank" rel="noreferrer" aria-label="וואטסאפ"><Icon name="wa" size={16} /></a>}
      {phone && <a className="ib" href={`tel:${phone}`} aria-label="שיחה"><Icon name="phone" size={16} /></a>}
      {email && <a className="ib" href={`mailto:${email}`} aria-label="מייל"><Icon name="chat" size={16} /></a>}
    </span>
  );
}
