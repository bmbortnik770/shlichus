import { useMemo, useState } from 'react';
import {
  type Campaign, type Db, type DonorSummary, type FamilyRef, GENERAL_CAMPAIGN, addDonation, campaignTotals, displayName,
  donorSummaries, getBuilding, getCampaigns, listDonations, listFamilies, monthlyTotals, setCampaigns,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import '../community.css';
import '../donations.css';

const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`;
const dateText = (d: Date | null) => (d ? d.toLocaleDateString('he-IL') : '');

export function Donations({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'total' | 'recent' | 'count'>('total');
  const [camp, setCamp] = useState('');
  const [onlyThanks, setOnlyThanks] = useState(false);
  const [report, setReport] = useState<DonorSummary | null>(null);
  const [openFam, setOpenFam] = useState<FamilyRef | null>(null);
  const [campDlg, setCampDlg] = useState(false);

  const rows = useMemo(() => listDonations(db), [db]);
  const now = new Date();
  const scoped = camp ? rows.filter((r) => r.campaign === camp) : rows;
  const total = scoped.reduce((s, r) => s + r.amount, 0);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const thisYear = scoped.filter((r) => r.date && r.date >= yearStart).reduce((s, r) => s + r.amount, 0);
  const last30 = scoped.filter((r) => r.date && now.getTime() - r.date.getTime() <= 30 * 86400000);
  const months = monthlyTotals(scoped, 12, now);
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const byCamp = [...campaignTotals(rows).entries()].sort((a, b) => b[1] - a[1]);
  const campaigns = getCampaigns(db);

  const donors = useMemo(() => {
    const keys = new Set(scoped.map((r) => `${r.ref.bldg}|${r.ref.idx}`));
    return donorSummaries(db).filter((d) => keys.has(`${d.ref.bldg}|${d.ref.idx}`));
  }, [db, scoped]);
  const thanksCount = donors.filter((d) => d.needsThanks).length;
  const shownDonors = donors
    .filter((d) => (!q.trim() || d.name.includes(q.trim())) && (!onlyThanks || d.needsThanks))
    .sort((a, b) => (sort === 'total' ? b.total - a.total : sort === 'count' ? b.count - a.count : (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0)));

  return (
    <>
      <section className="hello">
        <div>
          <h1>תרומות</h1>
          <p className="lede">
            {rows.length === 0 ? 'עוד לא נרשמו תרומות. תרומה נרשמת כאן או בכרטיס המשפחה, והמערכת תזכיר להודות.'
              : thanksCount > 0 ? <>{thanksCount === 1 ? 'תורם אחד עוד לא קיבל תודה. ' : <><b className="num">{thanksCount}</b> תורמים עוד לא קיבלו תודה. </>}<button className="link" onClick={() => setOnlyThanks(true)}>להציג אותם</button></>
              : 'כל התורמים קיבלו תודה.'}
          </p>
        </div>
        <div className="hello-acts">
          <button className="btn" onClick={() => setCampDlg(true)}>קמפיינים</button>
          <QuickDonation db={db} onSave={(ref, name, amount, campaign, date) => {
            const undo = mutate((d) => addDonation(d, ref, { amount, campaign, date }));
            toast(`נרשמה תרומה של ${ils(amount)} מ${name}`, undo);
          }} />
        </div>
      </section>

      <section className="don-kpis">
        <div className="panel kpi"><span>השנה</span><b className="num">{ils(thisYear)}</b></div>
        <div className="panel kpi"><span>30 הימים האחרונים</span><b className="num">{ils(last30.reduce((s, r) => s + r.amount, 0))}</b><small>{last30.length} תרומות</small></div>
        <div className="panel kpi"><span>מאז ומעולם</span><b className="num">{ils(total)}</b><small>{scoped.length} תרומות</small></div>
        <div className="panel kpi"><span>משפחות תורמות</span><b className="num">{donors.length}</b><small>ממוצע {ils(donors.length ? total / donors.length : 0)}</small></div>
      </section>

      <div className="don-grid">
        <section className="panel don-chart">
          <h2>לפי חודש</h2>
          {/* עמודות בקנה מידה אחד: גובה = סכום / החודש הגבוה */}
          <div className="bars" role="img" aria-label={`תרומות ב-12 החודשים האחרונים, השיא ${ils(maxMonth)}`}>
            {months.map((m) => (
              <div className="bar-col" key={m.key} title={`${m.label}: ${ils(m.total)}`}>
                <span className="bar-val">{m.total ? ils(m.total) : ''}</span>
                <div className="bar" style={{ height: `${(m.total / maxMonth) * 100}%` }} />
                <span className="bar-lbl">{m.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel don-camps">
          <h2>לפי קמפיין</h2>
          {byCamp.length === 0 && <p className="muted">עוד אין תרומות.</p>}
          {byCamp.map(([name, amt]) => {
            const c = campaigns.find((x) => x.label === name);
            const base = c?.goal || rows.reduce((s, r) => s + r.amount, 0);
            return (
              <button key={name} className={`camp${camp === name ? ' on' : ''}`} onClick={() => setCamp(camp === name ? '' : name)}>
                <span className="camp-top"><b>{name}</b><span className="num">{ils(amt)}{c?.goal ? ` מתוך ${ils(c.goal)}` : ''}</span></span>
                <span className="camp-bar"><i style={{ width: `${Math.min(100, (amt / Math.max(1, base)) * 100)}%` }} /></span>
              </button>
            );
          })}
        </section>
      </div>

      <div className="com-bar">
        <label className="search com-search"><Icon name="search" size={16} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש תורם" /></label>
        {camp && <button className="chip-f" aria-pressed onClick={() => setCamp('')}>{camp} ✕</button>}
        <button className="chip-f" aria-pressed={onlyThanks} onClick={() => setOnlyThanks(!onlyThanks)}>צריך תודה <span className="num">{thanksCount}</span></button>
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="מיון">
          <option value="total">מיון: סכום</option><option value="recent">מיון: אחרונים</option><option value="count">מיון: מספר תרומות</option>
        </select>
      </div>

      {shownDonors.length === 0 ? <section className="panel empty-state">אין תורמים להצגה.</section> : (
        <ul className="panel donors">
          {shownDonors.map((d) => (
            <li key={`${d.ref.bldg}|${d.ref.idx}`} onClick={() => setReport(d)}>
              <div className="dn-main"><b>{d.name}</b><span>{d.count} תרומות · אחרונה {dateText(d.last)}</span></div>
              {d.needsThanks && <span className="pill st-warm">צריך תודה</span>}
              <b className="dn-total num">{ils(d.total)}</b>
            </li>
          ))}
        </ul>
      )}

      {report && (
        <Dialog title={`דוח תורם · ${report.name}`} onClose={() => setReport(null)}>
          <div className="fc-total"><span>סה״כ</span><b className="num">{ils(report.total)}</b><span>{report.count} תרומות</span></div>
          <ul className="fc-list">
            {rows.filter((r) => r.ref.bldg === report.ref.bldg && r.ref.idx === report.ref.idx).map((r, i) => (
              <li key={i}><b className="num">{ils(r.amount)}</b><span>{r.campaign}</span><span className="meta">{dateText(r.date)}</span></li>
            ))}
          </ul>
          <div className="dialog-acts"><button className="btn btn-primary" onClick={() => { setOpenFam(report.ref); setReport(null); }}>לכרטיס המשפחה</button></div>
        </Dialog>
      )}
      {campDlg && <CampaignsDialog campaigns={campaigns} onClose={() => setCampDlg(false)} onSave={(list) => { const undo = mutate((d) => setCampaigns(d, list)); toast('הקמפיינים נשמרו', undo); setCampDlg(false); }} />}
      {openFam && getBuilding(db, openFam.bldg)?.apts[openFam.idx] && <FamilyCard db={db} fref={openFam} onClose={() => setOpenFam(null)} onMoved={setOpenFam} />}
    </>
  );
}

function QuickDonation({ db, onSave }: { db: Db; onSave: (ref: FamilyRef, name: string, amount: number, campaign: string, date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('');
  const [campaign, setCampaign] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const families = useMemo(() => listFamilies(db).map((r) => ({ ref: { bldg: r.bldg, idx: r.idx }, name: displayName(r.apt) })).filter((f) => f.name), [db]);
  const fam = families.find((f) => f.name === who.trim());
  const campaigns = getCampaigns(db).filter((c) => c.active !== false);
  if (!open) return <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={16} />רישום תרומה</button>;
  return (
    <Dialog title="רישום תרומה" onClose={() => setOpen(false)}>
      <label className="fld"><span>משפחה</span><input list="don-fams" value={who} onChange={(e) => setWho(e.target.value)} placeholder="התחל להקליד שם" /></label>
      <datalist id="don-fams">{families.map((f, i) => <option key={i} value={f.name} />)}</datalist>
      <div className="ev-row">
        <label className="fld"><span>סכום ₪</span><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" dir="ltr" /></label>
        <label className="fld"><span>תאריך</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label className="fld"><span>קמפיין</span>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">{GENERAL_CAMPAIGN}</option>{campaigns.map((c) => <option key={c.key} value={c.label}>{c.label}</option>)}</select>
      </label>
      {who.trim() && !fam && <p className="dialog-note addr-missing">לא נמצאה משפחה בשם הזה.</p>}
      <div className="dialog-acts">
        <button className="btn" onClick={() => setOpen(false)}>ביטול</button>
        <button className="btn btn-primary" disabled={!fam || !Number(amount)} onClick={() => { onSave(fam!.ref, fam!.name, Number(amount), campaign, date); setOpen(false); setWho(''); setAmount(''); }}>רישום</button>
      </div>
    </Dialog>
  );
}

function CampaignsDialog({ campaigns, onClose, onSave }: { campaigns: Campaign[]; onClose: () => void; onSave: (c: Campaign[]) => void }) {
  const [list, setList] = useState<Campaign[]>(campaigns.map((c) => ({ ...c })));
  const set = (i: number, patch: Partial<Campaign>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Dialog title="קמפיינים" onClose={onClose}>
      <p className="dialog-note">קמפיין לא פעיל לא מופיע ברישום תרומה חדשה, אבל התרומות שלו נשמרות.</p>
      {list.map((c, i) => (
        <div className="camp-edit" key={c.key}>
          <input value={c.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="שם הקמפיין" />
          <input value={c.goal ?? ''} onChange={(e) => set(i, { goal: Number(e.target.value.replace(/\D/g, '')) || undefined })} placeholder="יעד ₪" inputMode="numeric" dir="ltr" aria-label="יעד" />
          <label className="chk-row"><input type="checkbox" checked={c.active !== false} onChange={(e) => set(i, { active: e.target.checked })} />פעיל</label>
        </div>
      ))}
      <button className="btn" onClick={() => setList((l) => [...l, { key: `c_${Date.now()}`, label: '', year: new Date().getFullYear(), active: true }])}><Icon name="plus" size={15} />קמפיין</button>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" onClick={() => onSave(list.filter((c) => c.label.trim()))}>שמירה</button></div>
    </Dialog>
  );
}
