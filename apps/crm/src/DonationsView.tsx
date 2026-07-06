import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

interface DonationRow {
  family: string;
  bldg: string;
  date: string;
  amount: number;
  campaign: string;
}

export function DonationsView({ db }: { db: Db }) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const out: DonationRow[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        (a.donations ?? []).forEach((d) => {
          out.push({
            family: a.name || '—',
            bldg: key,
            date: String(d.date ?? ''),
            amount: Number(d.amount ?? 0) || 0,
            campaign: String(d.campaign ?? ''),
          });
        });
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [db]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? rows.filter((r) => [r.family, r.bldg, r.campaign].some((f) => f.includes(q))) : rows;
  }, [rows, query]);

  const total = filtered.reduce((s, r) => s + r.amount, 0);

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">תרומות</h2>
        <input
          type="search"
          placeholder="חיפוש משפחה או קמפיין…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="count">
          {filtered.length} תרומות · סה״כ {total.toLocaleString('he-IL')} ₪
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="placeholder">אין תרומות להצגה.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>תאריך</th><th>משפחה</th><th>כתובת</th><th>סכום</th><th>קמפיין</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>{r.family}</td>
                  <td>{r.bldg}</td>
                  <td className="amount">{r.amount.toLocaleString('he-IL')} ₪</td>
                  <td>{r.campaign}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
