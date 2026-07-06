import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

interface Donor {
  name: string;
  bldg: string;
  count: number;
  total: number;
  last: string;
}

/** מרכז תרומות — כמו בישן: KPI, לפי קמפיין, שורות תורמים */
export function DonationsView({ db, onOpenFamily }: { db: Db; onOpenFamily?: (q: string) => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'amount' | 'recent'>('amount');

  const { donors, total, campaigns } = useMemo(() => {
    const donors: Donor[] = [];
    const campaigns = new Map<string, number>();
    let total = 0;
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        const dons = a.donations ?? [];
        if (!dons.length) return;
        let sum = 0, last = '';
        dons.forEach((d) => {
          const amt = Number(d.amount) || 0;
          sum += amt;
          total += amt;
          const c = String(d.campaign ?? '').trim() || 'כללי';
          campaigns.set(c, (campaigns.get(c) ?? 0) + amt);
          if (String(d.date ?? '') > last) last = String(d.date ?? '');
        });
        donors.push({ name: a.name || key, bldg: key, count: dons.length, total: sum, last });
      });
    }
    return { donors, total, campaigns: [...campaigns.entries()].sort((a, b) => b[1] - a[1]) };
  }, [db]);

  const filtered = donors
    .filter((d) => !query.trim() || d.name.includes(query.trim()))
    .sort((a, b) => (sort === 'amount' ? b.total - a.total : b.last.localeCompare(a.last)));

  const avg = donors.length ? Math.round(total / donors.length) : 0;

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-hand-holding-heart" /> מרכז תרומות</h2>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="kpi-num" style={{ color: 'var(--success)' }}>{total.toLocaleString('he-IL')}₪</div><div className="kpi-label">סך כל התרומות</div></div>
        <div className="kpi"><div className="kpi-num">{donors.length}</div><div className="kpi-label">משפחות תורמות</div></div>
        <div className="kpi"><div className="kpi-num" style={{ color: '#8b5cf6' }}>{avg.toLocaleString('he-IL')}₪</div><div className="kpi-label">ממוצע למשפחה</div></div>
      </div>

      {campaigns.length > 0 && (
        <div className="settings-card" style={{ marginBottom: 14 }}>
          <h3><i className="fas fa-chart-bar" /> לפי קמפיין</h3>
          {campaigns.map(([name, amt]) => (
            <div key={name} className="camp-row">
              <div className="camp-head">
                <span>{name}</span>
                <span className="camp-amt">{amt.toLocaleString('he-IL')}₪ ({total ? Math.round((amt / total) * 100) : 0}%)</span>
              </div>
              <div className="camp-bar"><div style={{ width: `${total ? (amt / total) * 100 : 0}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="table-toolbar" style={{ margin: '0 0 10px' }}>
        <input type="search" placeholder="חיפוש לפי שם…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="board-select" value={sort} onChange={(e) => setSort(e.target.value as 'amount' | 'recent')}>
          <option value="amount">מיון: סכום יורד</option>
          <option value="recent">מיון: אחרונות</option>
        </select>
      </div>

      {filtered.length === 0 ? <p className="placeholder">אין תרומות להצגה.</p> : (
        <div className="donor-list">
          {filtered.map((d, i) => (
            <button className="donor-row" key={i} onClick={() => onOpenFamily?.(d.name)}>
              <span className="donor-badge">{d.count}</span>
              <span className="donor-main">
                <strong>{d.name}</strong>
                <span className="tpl-text">{d.bldg} · {d.count} תרומות{d.last ? ` · אחרונה: ${d.last}` : ''}</span>
              </span>
              <span className="donor-total">{d.total.toLocaleString('he-IL')}₪</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
