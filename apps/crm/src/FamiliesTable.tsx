import { useMemo, useState } from 'react';
import {
  type Apartment, type Db,
  NO_ADDRESS_KEY, buildingKeys, getBuilding, getStatusColor, liveApts,
} from '@shlichus/core';
import { FamilyCard } from './FamilyCard';
import { useCrm } from './store';

interface Row {
  bldg: string;
  idx: number;
  apt: Apartment;
}

/* עמודות זהות ל-allTableCols בישן */
const BASE_COLS = [
  { id: 'address', label: 'כתובת', sortable: true },
  { id: 'name', label: 'משפחה', sortable: true },
  { id: 'father', label: 'שם האב', sortable: true },
  { id: 'mother', label: 'שם האם', sortable: true },
  { id: 'phone', label: 'טלפונים', sortable: false },
  { id: 'email', label: 'מיילים', sortable: false },
  { id: 'style', label: 'סגנון', sortable: true },
  { id: 'boards', label: 'פרויקטים', sortable: false },
  { id: 'tags', label: 'תגיות', sortable: false },
  { id: 'children', label: 'כמות ילדים', sortable: false },
  { id: 'notes', label: 'הערות פנימיות', sortable: false },
  { id: 'lastContact', label: 'קשר אחרון', sortable: true },
] as const;

// ברירת המחדל של הישן
const DEFAULT_VISIBLE = ['address', 'name', 'boards', 'tags', 'lastContact', 'actions'];

function lastContactDate(a: Apartment): string {
  const logs = a.interactions ?? [];
  if (!logs.length) return '';
  return [...logs].sort((x, y) => new Date(String(y.date)).getTime() - new Date(String(x.date)).getTime())[0]?.date?.toString() ?? '';
}

function cleanPhone(p: string) { return p.replace(/\D/g, ''); }

export function FamiliesTable({
  db, initialQuery = '', onOpenBuilding,
  filterStyle = '', filterTag = '',
}: { db: Db; initialQuery?: string; onOpenBuilding?: (key: string) => void; filterStyle?: string; filterTag?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: 'name', direction: 'asc' });
  const styleFilter = filterStyle;
  const tagFilter = filterTag;
  const [smartView, setSmartView] = useState('v_all');
  const [colsMenu, setColsMenu] = useState(false);
  const [selected, setSelected] = useState<{ bldg: string; idx: number } | null>(null);
  const [bulk, setBulk] = useState<Set<string>>(new Set());

  const updateApt = useCrm((s) => s.updateApt);
  const deleteApt = useCrm((s) => s.deleteApt);
  const addApt = useCrm((s) => s.addApt);
  const splitFamily = useCrm((s) => s.splitFamily);
  const updateSettings = useCrm((s) => s.updateSettings);

  const settings = db.__SETTINGS__ ?? {};
  const allStyles = (settings.styles ?? []) as string[];
  const allTags = (settings.tags ?? []) as string[];
  const customFields = (settings.customFields ?? []) as string[];
  const smartViews = ((settings.smartViews ?? []) as { id: string; name: string; rule: string }[]);
  const boardsById = new Map(((db.__BOARDS__ ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const density = String(settings.tableDensity ?? 'normal');

  const allCols = useMemo(() => ([
    ...BASE_COLS,
    ...customFields.map((f) => ({ id: `custom_${f}`, label: f, sortable: true })),
    { id: 'actions', label: 'פעולות מהירות', sortable: false },
  ]), [customFields]);

  const visible = ((settings.visibleColumns ?? DEFAULT_VISIBLE) as string[]);
  const shownCols = allCols.filter((c) => visible.includes(c.id));

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => out.push({ bldg: key, idx: entry.apts.indexOf(a), apt: a }));
    }
    return out;
  }, [db]);

  const smartRule = (r: Row): boolean => {
    const rule = smartViews.find((v) => v.id === smartView)?.rule ?? 'none';
    if (rule === 'no_visit_3m') {
      const d = lastContactDate(r.apt);
      return !d || Date.now() - new Date(d).getTime() > 90 * 86400000;
    }
    if (rule === 'bday_month') {
      const month = new Date().getMonth();
      return ((r.apt.milestones ?? []) as { type?: string; gregDate?: string }[]).some(
        (m) => String(m.type ?? '').includes('birthday') && new Date(m.gregDate ?? '').getMonth() === month
      );
    }
    return true;
  };

  const filtered = useMemo(() => {
    const q = query.trim();
    const matched = rows.filter((r) => {
      const a = r.apt;
      return (
        smartRule(r) &&
        (!styleFilter || a.style === styleFilter) &&
        (!tagFilter || (a.tags ?? []).includes(tagFilter)) &&
        (!q || [a.name, r.bldg, a.fatherPhone, a.motherPhone, a.father, a.mother, a.style, ...(a.tags ?? [])]
          .some((f) => String(f ?? '').includes(q)))
      );
    });
    // מיון כמו tableSort בישן
    const { column, direction } = sort;
    const val = (r: Row): string => {
      const a = r.apt;
      if (column === 'name') return a.name ?? '';
      if (column === 'address') return r.bldg === NO_ADDRESS_KEY ? '' : r.bldg;
      if (column === 'father') return a.father ?? '';
      if (column === 'mother') return a.mother ?? '';
      if (column === 'style') return a.style ?? '';
      if (column === 'lastContact') return lastContactDate(a);
      if (column.startsWith('custom_')) return String((a.customFields as Record<string, unknown>)?.[column.slice(7)] ?? '');
      return '';
    };
    return [...matched].sort((x, y) => {
      const a = val(x), b = val(y);
      if (a < b) return direction === 'asc' ? -1 : 1;
      if (a > b) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, styleFilter, tagFilter, smartView, db]);

  const sortBy = (col: string) =>
    setSort((s) => ({ column: col, direction: s.column === col && s.direction === 'asc' ? 'desc' : 'asc' }));

  const rowKey = (r: Row) => `${r.bldg}|${r.idx}`;
  const toggleBulk = (k: string) =>
    setBulk((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const quickAdd = async () => {
    const created = await addApt('');
    if (created) setSelected(created);
  };

  const exportCsv = () => {
    const head = shownCols.filter((c) => c.id !== 'actions').map((c) => c.label);
    const lines = filtered.map((r) =>
      shownCols.filter((c) => c.id !== 'actions').map((c) => `"${cellText(r, c.id).replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `קהילה-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cellText = (r: Row, colId: string): string => {
    const a = r.apt;
    switch (colId) {
      case 'address': return r.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${r.bldg} ${a.num ?? ''}`.trim();
      case 'name': return a.name ?? '';
      case 'father': return a.father ?? '';
      case 'mother': return a.mother ?? '';
      case 'phone': return [a.fatherPhone, a.motherPhone].filter(Boolean).join(' · ');
      case 'email': return [a.fatherEmail, a.motherEmail].filter(Boolean).join(' · ');
      case 'style': return a.style ?? '';
      case 'boards': return Object.keys(a.boards ?? {}).map((id) => boardsById.get(id) ?? '').filter(Boolean).join(' · ');
      case 'tags': return (a.tags ?? []).join(' · ');
      case 'children': return String((a.childrenList ?? []).length || '');
      case 'notes': return (a.notes ?? '').slice(0, 40);
      case 'lastContact': return lastContactDate(a);
      default:
        if (colId.startsWith('custom_')) return String((a.customFields as Record<string, unknown>)?.[colId.slice(7)] ?? '');
        return '';
    }
  };

  const bulkDelete = async () => {
    if (!window.confirm(`למחוק ${bulk.size} משפחות? (המחיקה מסתנכרנת לכל המכשירים)`)) return;
    for (const k of bulk) { const [b, i] = k.split('|'); await deleteApt(b!, Number(i)); }
    setBulk(new Set());
  };
  const bulkAddTag = async () => {
    const tag = window.prompt('איזו תגית להוסיף לנבחרות?');
    if (!tag?.trim()) return;
    for (const k of bulk) {
      const [b, i] = k.split('|');
      const apt = getBuilding(db, b!)?.apts[Number(i)];
      if (apt && !(apt.tags ?? []).includes(tag.trim())) {
        await updateApt(b!, Number(i), { tags: [...(apt.tags ?? []), tag.trim()] });
      }
    }
    setBulk(new Set());
  };

  const selectedApt = selected ? getBuilding(db, selected.bldg)?.apts[selected.idx] : undefined;
  const padY = density === 'compact' ? 7 : density === 'spacious' ? 18 : 13;

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-list" /> אינדקס קהילה</h2>
        <span className="count">{filtered.length} משפחות</span>
        <button className="edit-btn" onClick={() => void quickAdd()}>
          <i className="fas fa-plus" /> משפחה חדשה
        </button>
        {/* צפיפות — כמו setDensity בישן */}
        <span className="channel-tabs" title="צפיפות תצוגה">
          {(['compact', 'normal', 'spacious'] as const).map((d) => (
            <button
              key={d}
              className={density === d ? 'chan active' : 'chan'}
              title={d === 'compact' ? 'צפוף' : d === 'normal' ? 'רגיל' : 'מרווח'}
              onClick={() => void updateSettings({ tableDensity: d })}
            >
              <i className={`fas ${d === 'compact' ? 'fa-grip-lines' : d === 'normal' ? 'fa-align-justify' : 'fa-expand-arrows-alt'}`} />
            </button>
          ))}
        </span>
        <span style={{ position: 'relative' }}>
          <button className="login-btn" onClick={() => setColsMenu((v) => !v)}>
            <i className="fas fa-table-columns" /> הגדרות טבלה
          </button>
          {colsMenu && (
            <div className="cols-menu">
              {allCols.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={visible.includes(c.id)}
                    onChange={() =>
                      void updateSettings({
                        visibleColumns: visible.includes(c.id) ? visible.filter((x) => x !== c.id) : [...visible, c.id],
                      })
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </span>
        <button className="login-btn" onClick={exportCsv}>
          <i className="fas fa-file-excel" /> ייצוא
        </button>
      </div>

      {bulk.size > 0 && (
        <div className="bulk-bar">
          <span>{bulk.size} סומנו</span>
          <button onClick={() => void bulkAddTag()}><i className="fas fa-tag" /> תגית</button>
          <button className="danger" onClick={() => void bulkDelete()}><i className="fas fa-trash" /> מחיקה</button>
          <button onClick={() => setBulk(new Set())}>נקה בחירה</button>
        </div>
      )}

      <div className="filter-row">
        <input
          type="search"
          placeholder="חיפוש מהיר — שם, טלפון, רחוב…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, maxWidth: 300, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
        />
        {smartViews.length > 0 && (
          <label className="filter-pill">
            <i className="fas fa-magic" /> תצוגה חכמה
            <select value={smartView} onChange={(e) => setSmartView(e.target.value)}>
              {smartViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              {shownCols.map((c) => (
                <th key={c.id} onClick={c.sortable ? () => sortBy(c.id === 'lastContact' ? 'lastContact' : c.id) : undefined}
                    style={{ cursor: c.sortable ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                  {c.label}
                  {sort.column === c.id && <i className={`fas fa-caret-${sort.direction === 'asc' ? 'up' : 'down'}`} style={{ marginInlineStart: 4 }} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const a = r.apt;
              const phone = a.fatherPhone || a.motherPhone || '';
              const email = a.fatherEmail || a.motherEmail || '';
              return (
                <tr key={rowKey(r)} className="clickable" onClick={() => setSelected({ bldg: r.bldg, idx: r.idx })}>
                  <td onClick={(e) => e.stopPropagation()} style={{ paddingTop: padY, paddingBottom: padY }}>
                    <input type="checkbox" className="bulk-check" checked={bulk.has(rowKey(r))} onChange={() => toggleBulk(rowKey(r))} />
                  </td>
                  {shownCols.map((c) => (
                    <td key={c.id} style={{ paddingTop: padY, paddingBottom: padY }}>
                      {c.id === 'address' ? (
                        <span
                          className="addr-link"
                          onClick={(e) => {
                            if (r.bldg !== NO_ADDRESS_KEY && onOpenBuilding) { e.stopPropagation(); onOpenBuilding(r.bldg); }
                          }}
                        >
                          <i className="fas fa-map-marker-alt" /> {cellText(r, 'address')}
                        </span>
                      ) : c.id === 'name' ? (
                        <span className="fam-name">{a.name || '—'}</span>
                      ) : c.id === 'tags' ? (
                        (a.tags ?? []).map((t) => <span className="tag-chip" key={t}>{t}</span>)
                      ) : c.id === 'lastContact' ? (
                        <span style={{ whiteSpace: 'nowrap' }}>
                          <span className="status-dot" style={{ background: getStatusColor(a, settings) }} />
                          {lastContactDate(a) || '—'}
                        </span>
                      ) : c.id === 'actions' ? (
                        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                          {phone && <a href={`tel:${cleanPhone(phone)}`} title="חייג"><i className="fas fa-phone" /></a>}
                          {phone && <a href={`https://wa.me/972${cleanPhone(phone).replace(/^0/, '')}`} target="_blank" rel="noreferrer" title="וואטסאפ" style={{ color: '#25D366' }}><i className="fab fa-whatsapp" /></a>}
                          {phone && <a href={`sms:${cleanPhone(phone)}`} title="SMS" style={{ color: '#0ea5e9' }}><i className="fas fa-sms" /></a>}
                          {email && <a href={`mailto:${email}`} title="שלח מייל" style={{ color: '#ea4335' }}><i className="fas fa-envelope" /></a>}
                        </span>
                      ) : (
                        cellText(r, c.id)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && selectedApt && (
        <FamilyCard
          db={db}
          bldg={selected.bldg}
          apt={selectedApt}
          onClose={() => setSelected(null)}
          onSave={(patch) => updateApt(selected.bldg, selected.idx, patch)}
          onSplit={async (memberName) => {
            const created = await splitFamily(selected.bldg, selected.idx, memberName);
            if (created) setSelected(created);
          }}
        />
      )}
    </section>
  );
}
