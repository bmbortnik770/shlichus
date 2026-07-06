import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts, NO_ADDRESS_KEY } from '@shlichus/core';
import { FamilyCard } from './FamilyCard';
import { useCrm } from './store';

interface Row {
  bldg: string;
  idx: number;
  name: string;
  num: string;
  phone: string;
  style: string;
  tags: string[];
  lastContactDays: number | null;
}

/** ימים מאז האינטראקציה האחרונה — זהה ללוגיקת scoring.js בישן */
function lastContactDays(interactions: { date?: string }[] | undefined): number | null {
  if (!interactions?.length) return null;
  const latest = interactions.reduce((max, i) => {
    const t = new Date(i.date ?? '').getTime();
    return isNaN(t) ? max : Math.max(max, t);
  }, 0);
  return latest ? Math.floor((Date.now() - latest) / 86400000) : null;
}

function toRows(db: Db): Row[] {
  const rows: Row[] = [];
  for (const key of buildingKeys(db)) {
    const entry = getBuilding(db, key);
    if (!entry) continue;
    liveApts(entry.apts).forEach((a) => {
      rows.push({
        bldg: key,
        idx: entry.apts.indexOf(a),
        name: a.name ?? '',
        num: a.num ?? '',
        phone: a.fatherPhone || a.motherPhone || '',
        style: a.style ?? '',
        tags: a.tags ?? [],
        lastContactDays: lastContactDays(a.interactions),
      });
    });
  }
  return rows;
}

export function FamiliesTable({ db, initialQuery = '' }: { db: Db; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [sortBy, setSortBy] = useState<'name' | 'bldg' | 'style'>('name');
  const [styleFilter, setStyleFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const allStyles = (db.__SETTINGS__?.styles ?? []) as string[];
  const allTags = (db.__SETTINGS__?.tags ?? []) as string[];
  const [selected, setSelected] = useState<{ bldg: string; idx: number } | null>(null);
  const updateApt = useCrm((s) => s.updateApt);
  // הדירה הנבחרת נגזרת מה-db בכל רנדר — נשארת עדכנית אחרי שמירה
  const selectedApt = selected ? getBuilding(db, selected.bldg)?.apts[selected.idx] : undefined;

  const rows = useMemo(() => toRows(db), [db]);
  const filtered = useMemo(() => {
    const q = query.trim();
    const matched = rows.filter(
      (r) =>
        (!styleFilter || r.style === styleFilter) &&
        (!tagFilter || r.tags.includes(tagFilter)) &&
        (!q || [r.name, r.bldg, r.phone, r.style, ...r.tags].some((f) => f.includes(q)))
    );
    return [...matched].sort((a, b) => (a[sortBy] || '').localeCompare(b[sortBy] || '', 'he'));
  }, [rows, query, sortBy, styleFilter, tagFilter]);

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-list" /> אינדקס קהילה</h2>
        <span className="count">{filtered.length} משפחות</span>
      </div>
      <div className="filter-row">
        <input
          type="search"
          placeholder="חיפוש מהיר — שם, טלפון, רחוב…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, maxWidth: 300, padding: '7px 14px', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
        />
        <label className="filter-pill">
          <i className="fas fa-palette" /> סגנון
          <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}>
            <option value="">הכל</option>
            {allStyles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="filter-pill">
          <i className="fas fa-tags" /> תגיות
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">הכל</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => setSortBy('name')}>משפחה</th>
              <th onClick={() => setSortBy('bldg')}>כתובת</th>
              <th>טלפון</th>
              <th onClick={() => setSortBy('style')}>סגנון</th>
              <th>קשר אחרון</th>
              <th>תגיות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={`${r.bldg}|${r.idx}`}
                className="clickable"
                onClick={() => setSelected({ bldg: r.bldg, idx: r.idx })}
              >
                <td className="fam-name">{r.name || '—'}</td>
                <td>
                  <span className="addr-link">
                    <i className="fas fa-map-marker-alt" />
                    {r.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${r.bldg} ${r.num}`.trim()}
                  </span>
                </td>
                <td dir="ltr">{r.phone}</td>
                <td>{r.style}</td>
                <td>
                  {r.lastContactDays === null ? (
                    <span className="contact-badge none">אין תיעוד</span>
                  ) : (
                    <span className={`contact-badge ${r.lastContactDays > 60 ? 'stale' : r.lastContactDays > 21 ? 'aging' : 'fresh'}`}>
                      {r.lastContactDays === 0 ? 'היום' : `לפני ${r.lastContactDays} ימים`}
                    </span>
                  )}
                </td>
                <td>{r.tags.map((t) => <span className="tag-chip" key={t}>{t}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && selectedApt && (
        <FamilyCard
          bldg={selected.bldg}
          apt={selectedApt}
          onClose={() => setSelected(null)}
          onSave={(patch) => updateApt(selected.bldg, selected.idx, patch)}
        />
      )}
    </section>
  );
}
