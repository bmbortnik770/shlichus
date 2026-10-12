import { useMemo, useState } from 'react';
import {
  type Channel, type Circle, type Db, type FamilyRef, type Recipient, type Template, circleName, displayName, getBuilding, getCircles,
  getSegments, getTemplates, listFamilies, logCall, logSent, personalize, recipients, refKey, sendLink, sentCount,
  newCircle, setCircleMember, setSetting,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import { agoText } from './Community';
import '../community.css';
import '../messages.css';

type Tab = 'send' | 'calls' | 'history' | 'templates' | 'circles';
const TABS: { key: Tab; label: string }[] = [
  { key: 'send', label: 'שליחה' }, { key: 'calls', label: 'חיוג' }, { key: 'history', label: 'היסטוריה' },
  { key: 'templates', label: 'תבניות' }, { key: 'circles', label: 'מעגלים' },
];
const CHANNELS: { key: Channel; label: string }[] = [{ key: 'whatsapp', label: 'וואטסאפ' }, { key: 'sms', label: 'SMS' }, { key: 'email', label: 'מייל' }];
const CIRCLE_COLORS = ['#0e6b64', '#2f6fae', '#b7791f', '#c2410c', '#5b4b8a', '#1f7a4d'];
const parseKey = (k: string): FamilyRef => { const i = k.lastIndexOf('|'); return { bldg: k.slice(0, i), idx: Number(k.slice(i + 1)) }; };

export function Messages({ db }: { db: Db }) {
  const [tab, setTab] = useState<Tab>('send');
  const [openFam, setOpenFam] = useState<FamilyRef | null>(null);
  const sent = sentCount(db);
  return (
    <>
      <section className="hello">
        <div>
          <h1>הודעות</h1>
          <p className="lede">{sent ? <><b className="num">{sent}</b> הודעות נשלחו ב-30 הימים האחרונים.</> : 'שליחה אישית לכל משפחה, עם תיעוד אוטומטי בכרטיס.'}</p>
        </div>
      </section>
      <nav className="msg-tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </nav>
      {tab === 'send' && <Send db={db} />}
      {tab === 'calls' && <Calls db={db} onOpen={setOpenFam} />}
      {tab === 'history' && <History db={db} onOpen={setOpenFam} />}
      {tab === 'templates' && <Templates db={db} />}
      {tab === 'circles' && <Circles db={db} onOpen={setOpenFam} />}
      {openFam && getBuilding(db, openFam.bldg)?.apts[openFam.idx] && <FamilyCard db={db} fref={openFam} onClose={() => setOpenFam(null)} onMoved={setOpenFam} />}
    </>
  );
}

/* ───────── שליחה ───────── */

function Send({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('הודעה מבית חב"ד');
  const [quick, setQuick] = useState<'all' | 'd30' | 'd60' | 'never' | 'tasks'>('all');
  const [style, setStyle] = useState('');
  const [tag, setTag] = useState('');
  const [circle, setCircle] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ keys: string[]; at: number; sent: Set<string> } | null>(null);
  const [segDlg, setSegDlg] = useState(false);

  const s = db.__SETTINGS__ ?? {};
  const styles = (s.styles ?? []) as string[];
  const tags = (s.tags ?? []) as string[];
  const circles = getCircles(db);
  const segments = getSegments(db);
  const templates = getTemplates(db);
  const all = useMemo(() => recipients(db, channel), [db, channel]);
  const filtered = all.filter((r) => {
    if (quick === 'd30' && !(r.daysSince === null || r.daysSince > 30)) return false;
    if (quick === 'd60' && !(r.daysSince === null || r.daysSince > 60)) return false;
    if (quick === 'never' && r.daysSince !== null) return false;
    if (quick === 'tasks' && !r.openTasks) return false;
    if (style && r.style !== style) return false;
    if (tag && !r.tags.includes(tag)) return false;
    if (circle && !r.circles.includes(circle)) return false;
    return !q.trim() || `${r.name} ${r.bldg} ${r.phone}`.includes(q.trim());
  });
  const chosen = all.filter((r) => sel.has(r.key));
  const byKey = new Map(all.map((r) => [r.key, r]));
  const aptOf = (r: Recipient) => getBuilding(db, r.bldg)!.apts[r.idx]!;
  const preview = chosen[0] ? personalize(text, aptOf(chosen[0])) : personalize(text, { name: 'כהן' });

  // ── מצב שליחה רצופה ──
  if (queue) {
    const cur = byKey.get(queue.keys[queue.at] ?? '');
    const done = queue.at >= queue.keys.length;
    const next = () => setQueue((x) => (x ? { ...x, at: x.at + 1 } : x));
    return (
      <section className="panel queue">
        <div className="queue-head">
          <b>שליחה רצופה · {Math.min(queue.at + 1, queue.keys.length)} מתוך {queue.keys.length}</b>
          <span className="meter"><i style={{ width: `${(queue.sent.size / queue.keys.length) * 100}%` }} /></span>
          <button className="btn" onClick={() => { setQueue(null); setSel(new Set()); }}>{done ? 'סיום' : 'עצירה'}</button>
        </div>
        {done || !cur ? (
          <div className="fix-done"><Icon name="done" size={22} /><div><b>נשלחו {queue.sent.size} הודעות</b><span>כל הודעה תועדה בכרטיס המשפחה.</span></div></div>
        ) : (
          <div className="queue-card">
            <div className="q-who"><b>{cur.name}</b><span dir="ltr">{channel === 'email' ? cur.email : cur.phone}</span><span className="meta">קשר אחרון: {cur.daysSince === null ? 'אין' : agoText(new Date(Date.now() - cur.daysSince * 86400000))}</span></div>
            <p className="q-text">{personalize(text, aptOf(cur))}</p>
            <div className="fix-acts">
              <a className="btn btn-primary" href={sendLink(channel, cur, personalize(text, aptOf(cur)), subject)} target="_blank" rel="noreferrer"
                onClick={() => { mutate((d) => logSent(d, cur, channel, personalize(text, aptOf(cur)))); setQueue((x) => (x ? { ...x, at: x.at + 1, sent: new Set(x.sent).add(cur.key) } : x)); }}>
                <Icon name={channel === 'email' ? 'chat' : 'wa'} size={16} />פתיחה ב{CHANNELS.find((c) => c.key === channel)!.label} ותיעוד
              </a>
              <button className="btn" onClick={next}>דילוג</button>
            </div>
            <p className="sheet-hint">כל לחיצה פותחת את ההודעה המוכנה. אחרי השליחה חוזרים לכאן והנמען הבא כבר מחכה.</p>
          </div>
        )}
        {queue.keys.length > 1 && (
          <ul className="queue-list">
            {queue.keys.map((k, i) => <li key={k} className={queue.sent.has(k) ? 'sent' : i === queue.at ? 'cur' : ''}>{byKey.get(k)?.name}{queue.sent.has(k) ? ' ✓' : ''}</li>)}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="send-grid">
      <section className="panel compose">
        <div className="seg" role="group" aria-label="ערוץ">
          {CHANNELS.map((c) => <button key={c.key} aria-pressed={channel === c.key} onClick={() => { setChannel(c.key); setSel(new Set()); }}>{c.label}</button>)}
        </div>
        {templates.length > 0 && (
          <select className="sel" value="" onChange={(e) => { const t = templates[Number(e.target.value)]; if (t) setText(t.text); }} aria-label="תבנית">
            <option value="">בחירת תבנית…</option>
            {templates.map((t, i) => <option key={i} value={i}>{t.title}</option>)}
          </select>
        )}
        {channel === 'email' && <label className="fld"><span>נושא</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
        <label className="fld"><span>ההודעה</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="שלום משפחת [שם]," /></label>
        <button className="chip-f" onClick={() => setText((t) => `${t}[שם]`)}>הוספת [שם]</button>
        {text.trim() && <div className="preview"><span className="meta">כך זה ייראה{chosen[0] ? ` אצל ${chosen[0].name}` : ''}:</span><p>{preview}</p></div>}
        <button className="btn btn-primary send-go" disabled={!text.trim() || !chosen.length} onClick={() => setQueue({ keys: chosen.map((r) => r.key), at: 0, sent: new Set() })}>
          {chosen.length ? `שליחה ל-${chosen.length} נמענים` : 'בחר נמענים'}
        </button>
        <p className="sheet-hint">שליחה אוטומטית לכולם בלחיצה אחת תהיה זמינה עם חיבור WhatsApp Business (חבילת Pro).</p>
      </section>

      <section className="panel audience">
        <div className="aud-head"><h2>למי</h2><span className="meta">{chosen.length} נבחרו · {filtered.length} מוצגים</span></div>
        <div className="chips">
          {([['all', 'כולם'], ['d30', '30+ יום בלי קשר'], ['d60', '60+ יום'], ['never', 'עוד לא היה קשר'], ['tasks', 'יש משימה פתוחה']] as const).map(([k, l]) => (
            <button key={k} className="chip-f" aria-pressed={quick === k} onClick={() => setQuick(k)}>{l}</button>
          ))}
        </div>
        <div className="aud-filters">
          <label className="search com-search"><Icon name="search" size={15} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש" /></label>
          {styles.length > 0 && <select className="sel" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="סגנון"><option value="">כל הסגנונות</option>{styles.map((x) => <option key={x}>{x}</option>)}</select>}
          {tags.length > 0 && <select className="sel" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="תגית"><option value="">כל התגיות</option>{tags.map((x) => <option key={x}>{x}</option>)}</select>}
          {circles.length > 0 && <select className="sel" value={circle} onChange={(e) => setCircle(e.target.value)} aria-label="מעגל"><option value="">כל המעגלים</option>{circles.map((c) => <option key={c.id} value={c.id}>{circleName(c)}</option>)}</select>}
          {segments.length > 0 && (
            <select className="sel" value="" onChange={(e) => { const sg = segments[Number(e.target.value)]; if (sg) setSel(new Set(sg.keys.filter((k) => byKey.has(k)))); }} aria-label="סגמנט שמור">
              <option value="">סגמנט שמור…</option>{segments.map((sg, i) => <option key={i} value={i}>{sg.name}</option>)}
            </select>
          )}
        </div>
        <div className="aud-acts">
          <button className="link" onClick={() => setSel(new Set([...sel, ...filtered.map((r) => r.key)]))}>בחירת כל המוצגים</button>
          {sel.size > 0 && <button className="link" onClick={() => setSel(new Set())}>ניקוי</button>}
          {sel.size > 0 && <button className="link" onClick={() => setSegDlg(true)}>שמירה כסגמנט</button>}
        </div>
        <ul className="aud-list">
          {filtered.map((r) => (
            <li key={r.key}>
              <label className="chk-row">
                <input type="checkbox" checked={sel.has(r.key)} onChange={() => setSel((x) => { const n = new Set(x); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} />
                <span className="nm-s">{r.name}</span>
              </label>
              <span className="meta" dir="ltr">{channel === 'email' ? r.email : r.phone}</span>
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">אין נמענים מתאימים{channel === 'email' ? ' (צריך כתובת מייל בכרטיס)' : ' (צריך טלפון בכרטיס)'}.</li>}
        </ul>
      </section>

      {segDlg && <NameDialog title="שמירת סגמנט" label="שם הסגמנט" onClose={() => setSegDlg(false)} onSave={(name) => {
        const undo = mutate((d) => setSetting(d, { savedSegments: [...getSegments(d), { name, keys: [...sel] }] }));
        toast(`הסגמנט "${name}" נשמר`, undo); setSegDlg(false);
      }} />}
    </div>
  );
}

function NameDialog({ title, label, initial = '', onClose, onSave }: { title: string; label: string; initial?: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }} className="ev-form">
        <label className="fld"><span>{label}</span><input value={v} onChange={(e) => setV(e.target.value)} /></label>
        <div className="dialog-acts"><button type="button" className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!v.trim()}>שמירה</button></div>
      </form>
    </Dialog>
  );
}

/* ───────── חיוג ───────── */

function Calls({ db, onOpen }: { db: Db; onOpen: (r: FamilyRef) => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [q, setQ] = useState('');
  const [logged, setLogged] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState<Record<string, string>>({});
  // מי שהכי מזמן לא דיברו איתו — ראשון
  const people = useMemo(() => recipients(db, 'whatsapp'), [db]);
  // הסדר נקבע פעם אחת בכניסה — משפחה שתועדה לא קופצת לסוף הרשימה באמצע העבודה
  const [order] = useState(() => new Map(recipients(db, 'whatsapp').sort((a, b) => (b.daysSince ?? 1e6) - (a.daysSince ?? 1e6)).map((r, i) => [r.key, i])));
  people.sort((a, b) => (order.get(a.key) ?? 1e6) - (order.get(b.key) ?? 1e6));
  const shown = people.filter((p) => !q.trim() || `${p.name} ${p.phone}`.includes(q.trim()));
  const log = (p: Recipient, result: string) => {
    const undo = mutate((d) => logCall(d, p, result, note[p.key] ?? ''));
    setLogged((m) => new Map(m).set(p.key, result));
    toast(`שיחה עם ${p.name}: ${result}`, undo);
  };
  return (
    <section className="panel calls">
      <div className="com-bar"><label className="search com-search"><Icon name="search" size={15} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש" /></label><span className="meta">{shown.length} עם טלפון · מי שהכי מזמן לא דיברתם איתו ראשון</span></div>
      <ul>
        {shown.map((p) => (
          <li key={p.key}>
            <div className="c-who"><button className="link" onClick={() => onOpen(p)}>{p.name}</button><span className="meta">{p.daysSince === null ? 'עוד לא היה קשר' : p.daysSince === 0 ? 'היום' : `לפני ${p.daysSince} ימים`}</span></div>
            <a className="btn" href={`tel:${p.phone}`} dir="ltr"><Icon name="phone" size={15} />{p.phone}</a>
            {logged.has(p.key) ? <span className="pill st-ok">תועד · {logged.get(p.key)}</span> : (
              <div className="c-log">
                <input value={note[p.key] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [p.key]: e.target.value }))} placeholder="הערה (לא חובה)" aria-label={`הערה לשיחה עם ${p.name}`} />
                <button className="chip-f" onClick={() => log(p, 'ענו')}>ענו</button>
                <button className="chip-f" onClick={() => log(p, 'לא ענו')}>לא ענו</button>
                <button className="chip-f" onClick={() => log(p, 'הושארה הודעה')}>הודעה</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────── היסטוריה ───────── */

function History({ db, onOpen }: { db: Db; onOpen: (r: FamilyRef) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(80);
  const items = useMemo(() => {
    const out: { ref: FamilyRef; name: string; date: string; t: number; type: string; text: string }[] = [];
    for (const r of listFamilies(db)) {
      const name = displayName(r.apt) || r.bldg;
      for (const l of r.apt.interactions ?? []) {
        const d = lastDate(String(l.date ?? ''));
        out.push({ ref: r, name, date: String(l.date ?? ''), t: d, type: String(l.type ?? ''), text: String(l.notes ?? l.text ?? '') });
      }
      for (const d of ((r.apt as Record<string, unknown>).convDocs ?? []) as Record<string, unknown>[]) {
        out.push({ ref: r, name, date: String(d.date ?? ''), t: lastDate(String(d.date ?? '')), type: 'תיעוד שיחה', text: [d.title, d.body].filter(Boolean).join(' · ') });
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }, [db]);
  const types = [...new Set(items.map((i) => i.type).filter(Boolean))];
  const shown = items.filter((i) => (!type || i.type === type) && (!q.trim() || `${i.name} ${i.text}`.includes(q.trim())));
  return (
    <section className="panel hist">
      <div className="com-bar">
        <label className="search com-search"><Icon name="search" size={15} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בהיסטוריה" /></label>
        <select className="sel" value={type} onChange={(e) => setType(e.target.value)} aria-label="סוג"><option value="">כל הסוגים</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="meta">{shown.length} רשומות</span>
      </div>
      {shown.length === 0 ? <p className="muted">אין עדיין תיעוד.</p> : (
        <ol className="timeline">
          {shown.slice(0, limit).map((i, k) => (
            <li key={k}><b>{i.type}</b><button className="chip-f" onClick={() => onOpen(i.ref)}>{i.name}</button><span className="meta">{i.date}</span>{i.text && <p>{i.text}</p>}</li>
          ))}
        </ol>
      )}
      {shown.length > limit && <button className="link" onClick={() => setLimit(limit + 100)}>להציג עוד</button>}
    </section>
  );
}

function lastDate(s: string): number {
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/* ───────── תבניות ───────── */

function Templates({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const list = getTemplates(db);
  const [edit, setEdit] = useState<{ i: number; t: Template } | null>(null);
  const save = (next: Template[], msg: string) => { const undo = mutate((d) => setSetting(d, { templates: next })); toast(msg, undo); };
  return (
    <section className="tpl-grid">
      {list.map((t, i) => (
        <article className="panel tpl" key={i}>
          <b>{t.title}</b>
          <p>{t.text}</p>
          <div className="fix-acts">
            <button className="btn" onClick={() => setEdit({ i, t })}>עריכה</button>
            <button className="btn btn-ghost-danger" onClick={() => void (async () => { if (await ask({ title: 'מחיקת תבנית', message: `למחוק את "${t.title}"?`, confirm: 'מחיקה', danger: true })) save(list.filter((_, j) => j !== i), 'התבנית נמחקה'); })()}>מחיקה</button>
          </div>
        </article>
      ))}
      <button className="panel tpl tpl-new" onClick={() => setEdit({ i: -1, t: { title: '', text: '' } })}><Icon name="plus" />תבנית חדשה</button>
      {edit && (
        <Dialog title={edit.i < 0 ? 'תבנית חדשה' : 'עריכת תבנית'} onClose={() => setEdit(null)}>
          <TemplateForm t={edit.t} onCancel={() => setEdit(null)} onSave={(t) => {
            save(edit.i < 0 ? [...list, t] : list.map((x, j) => (j === edit.i ? t : x)), 'התבנית נשמרה'); setEdit(null);
          }} />
        </Dialog>
      )}
    </section>
  );
}

function TemplateForm({ t, onCancel, onSave }: { t: Template; onCancel: () => void; onSave: (t: Template) => void }) {
  const [title, setTitle] = useState(t.title);
  const [text, setText] = useState(t.text);
  return (
    <form className="ev-form" onSubmit={(e) => { e.preventDefault(); if (title.trim() && text.trim()) onSave({ title: title.trim(), text: text.trim() }); }}>
      <label className="fld"><span>שם</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: ברכת חג" /></label>
      <label className="fld"><span>הטקסט</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="שלום משפחת [שם]," /></label>
      <button type="button" className="chip-f" onClick={() => setText((x) => `${x}[שם]`)}>הוספת [שם]</button>
      <div className="dialog-acts"><button type="button" className="btn" onClick={onCancel}>ביטול</button><button className="btn btn-primary" disabled={!title.trim() || !text.trim()}>שמירה</button></div>
    </form>
  );
}

/* ───────── מעגלים ───────── */

function Circles({ db, onOpen }: { db: Db; onOpen: (r: FamilyRef) => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const circles = getCircles(db);
  const colorOf = (i: number) => CIRCLE_COLORS[i % CIRCLE_COLORS.length];
  const [newOpen, setNewOpen] = useState(false);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const fams = useMemo(() => listFamilies(db).map((r) => ({ ref: { bldg: r.bldg, idx: r.idx }, key: refKey(r), name: displayName(r.apt), circles: ((r.apt.connectionCircles ?? []) as (string | { id?: string })[]).map((e) => (typeof e === 'string' ? e : e.id ?? '')) })).filter((f) => f.name), [db]);
  const add = (c: Circle) => {
    const f = fams.find((x) => x.name === (adding[c.id] ?? '').trim());
    if (!f) return;
    mutate((d) => setCircleMember(d, f.ref, c.id, true));
    setAdding((a) => ({ ...a, [c.id]: '' }));
  };
  return (
    <>
      <div className="com-bar"><button className="btn btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={16} />מעגל חדש</button><span className="meta">מעגל הוא קבוצת משפחות לשליחה ולמעקב, למשל "שיעור נשים" או "מניין שבת".</span></div>
      <section className="circle-grid">
        {circles.length === 0 && <div className="panel empty-state">עוד אין מעגלים.</div>}
        {circles.map((c, ci) => {
          const members = fams.filter((f) => f.circles.includes(c.id));
          return (
            <article className="panel circle" key={c.id} style={{ ['--c' as string]: colorOf(ci) }}>
              <header><i className="cdot" /><b>{circleName(c)}</b><span className="meta">{members.length} משפחות</span>
                <button className="ib" aria-label="מחיקת המעגל" onClick={() => void (async () => {
                  if (!(await ask({ title: 'מחיקת מעגל', message: `למחוק את המעגל "${circleName(c)}"? המשפחות לא נמחקות.`, confirm: 'מחיקה', danger: true }))) return;
                  const undo = mutate((d) => setSetting(d, { connectionCircles: getCircles(d).filter((x) => x.id !== c.id) }));
                  toast('המעגל נמחק', undo);
                })()}><Icon name="x" size={14} /></button>
              </header>
              <div className="chips">
                {members.map((m) => (
                  <span className="mchip" key={m.key}><button className="link" onClick={() => onOpen(m.ref)}>{m.name}</button>
                    <button className="mx" aria-label={`הסרת ${m.name}`} onClick={() => mutate((d) => setCircleMember(d, m.ref, c.id, false))}>×</button></span>
                ))}
              </div>
              <form className="fc-add" onSubmit={(e) => { e.preventDefault(); add(c); }}>
                <input list={`cf-${c.id}`} value={adding[c.id] ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [c.id]: e.target.value }))} placeholder="הוספת משפחה" aria-label={`הוספת משפחה ל${circleName(c)}`} />
                <datalist id={`cf-${c.id}`}>{fams.filter((f) => !f.circles.includes(c.id)).map((f) => <option key={f.key} value={f.name} />)}</datalist>
                <button className="btn" disabled={!(adding[c.id] ?? '').trim()}>הוספה</button>
              </form>
            </article>
          );
        })}
      </section>
      {newOpen && <NameDialog title="מעגל חדש" label="שם המעגל" onClose={() => setNewOpen(false)} onSave={(name) => {
        const undo = mutate((d) => { newCircle(d, name); });
        toast(`המעגל "${name}" נוצר`, undo); setNewOpen(false);
      }} />}
    </>
  );
}
