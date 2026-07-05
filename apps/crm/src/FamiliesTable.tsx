import { useMemo, useState } from 'react';
import { type Apartment, type Db, buildingKeys, getBuilding, liveApts, NO_ADDRESS_KEY } from '@shlichus/core';
import { FamilyCard } from './FamilyCard';

interface Row {
  bldg: string;
  idx: number;
  name: string;
  num: string;
  phone: string;
  style: string;
  tags: string[];
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
      });
    });
  }
  return rows;
}

export function FamiliesTable({ db }: { db: Db }) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'bldg' | 'style'>('name');
  const [selected, setSelected] = useState<{ bldg: string; apt: Apartment } | null>(null);

  const rows = useMemo(() => toRows(db), [db]);
  const filtered = useMemo(() => {
    const q = query.trim();
    const matched = q
      ? rows.filter((r) =>
          [r.name, r.bldg, r.phone, r.style, ...r.tags].some((f) => f.includes(q))
        )
      : rows;
    return [...matched].sort((a, b) => (a[sortBy] || '').localeCompare(b[sortBy] || '', 'he'));
  }, [rows, query, sortBy]);

  return (
    <section>
      <div className="table-toolbar">
        <input
          type="search"
          placeholder="חיפוש שם, כתובת, טלפון, תגית…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="count">{filtered.length} משפחות</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => setSortBy('name')}>משפחה</th>
              <th onClick={() => setSortBy('bldg')}>כתובת</th>
              <th>טלפון</th>
              <th onClick={() => setSortBy('style')}>סגנון</th>
              <th>תגיות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={`${r.bldg}|${r.idx}`}
                className="clickable"
                onClick={() => {
                  const apt = getBuilding(db, r.bldg)?.apts[r.idx];
                  if (apt) setSelected({ bldg: r.bldg, apt });
                }}
              >
                <td>{r.name || '—'}</td>
                <td>{r.bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${r.bldg} ${r.num}`.trim()}</td>
                <td dir="ltr">{r.phone}</td>
                <td>{r.style}</td>
                <td>{r.tags.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <FamilyCard bldg={selected.bldg} apt={selected.apt} onClose={() => setSelected(null)} />}
    </section>
  );
}
