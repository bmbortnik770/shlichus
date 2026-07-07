import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';
import { useCrm } from './store';
// eslint-disable-next-line @typescript-eslint/no-unused-vars


interface Recipient {
  key: string; // bldg|idx — אותו פורמט כמו המערכת הקיימת
  bldg: string;
  idx: number;
  name: string;
  phone: string;
  email: string;
  style: string;
  tags: string[];
  sent: boolean;
  lastContactDays: number | null;
}

/** טלפון ישראלי → פורמט wa.me (ללא 0 מוביל, עם 972) */
function waPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
}

function personalize(text: string, name: string): string {
  return text.replace(/\[\s*שם\s*\]/g, name || 'משפחה');
}

const COMM_TABS = [
  { key: 'compose', label: 'כתיבה ושליחה', icon: 'fa-paper-plane' },
  { key: 'calls', label: 'חיוג', icon: 'fa-phone' },
  { key: 'history', label: 'היסטוריה', icon: 'fa-clock-rotate-left' },
  { key: 'docs', label: 'תיעודים', icon: 'fa-file-lines' },
  { key: 'templates', label: 'תבניות', icon: 'fa-file-pen' },
] as const;

const DOC_CHANNELS: Record<string, string> = {
  general: 'כללי', phone: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה',
};

export function CommView({ db }: { db: Db }) {
  const updateApt = useCrm((s) => s.updateApt);
  const [commTab, setCommTab] = useState<string>('compose');
  const [query, setQuery] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'sms'>('whatsapp');
  const [quickFilter, setQuickFilter] = useState('all');

  // צ'יפים חכמים לקהל היעד — כמו בישן
  const QUICK_FILTERS = [
    { key: 'all', label: 'כולם' },
    { key: 'no60', label: '60+ יום' },
    { key: 'no30', label: '30+ יום' },
    { key: 'tasks', label: 'יש משימות' },
  ];

  const templates = ((db.__SETTINGS__?.templates ?? []) as { title?: string; text?: string }[]);
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];

  const recipients = useMemo(() => {
    const out: Recipient[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        const phone = a.fatherPhone || a.motherPhone || '';
        const email = a.fatherEmail || a.motherEmail || '';
        // וואטסאפ דורש טלפון; מייל דורש כתובת
        if (channel === 'email' ? !email : !phone) return;
        const latest = (a.interactions ?? []).reduce((max, i) => {
          const t = new Date(i.date ?? '').getTime();
          return isNaN(t) ? max : Math.max(max, t);
        }, 0);
        out.push({
          key: `${key}|${entry.apts.indexOf(a)}`,
          bldg: key,
          idx: entry.apts.indexOf(a),
          name: a.name ?? '',
          phone,
          email,
          style: a.style ?? '',
          tags: a.tags ?? [],
          sent: false,
          lastContactDays: latest ? Math.floor((Date.now() - latest) / 86400000) : null,
          hasTasks: (a.tasks ?? []).some((t) => !t.done),
        } as Recipient & { hasTasks: boolean });
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [db, channel]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return recipients.filter((r) => {
      if (quickFilter === 'no60' && !(r.lastContactDays === null || r.lastContactDays > 60)) return false;
      if (quickFilter === 'no30' && !(r.lastContactDays === null || r.lastContactDays > 30)) return false;
      if (quickFilter === 'tasks' && !(r as Recipient & { hasTasks?: boolean }).hasTasks) return false;
      return (
        (!styleFilter || r.style === styleFilter) &&
        (!q || [r.name, r.bldg, r.phone, ...r.tags].some((f) => f.includes(q)))
      );
    });
  }, [recipients, query, styleFilter, quickFilter]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () =>
    setSelected((s) =>
      s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.key))
    );

  const chosen = filtered.filter((r) => selected.has(r.key));

  /** שליחה לנמען: פותח וואטסאפ/מייל + מתעד אינטראקציה בפורמט של המערכת הקיימת */
  const sendTo = async (r: Recipient) => {
    const personal = personalize(text, r.name);
    if (channel === 'whatsapp') {
      const wp = waPhone(r.phone);
      if (!wp) return;
      window.open(`https://wa.me/${wp}?text=${encodeURIComponent(personal)}`, '_blank');
    } else if (channel === 'sms') {
      if (!r.phone) return;
      window.open(`sms:${r.phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(personal)}`, '_blank');
    } else {
      if (!r.email) return;
      window.open(
        `mailto:${r.email}?subject=${encodeURIComponent('הודעה מבית חב"ד')}&body=${encodeURIComponent(personal)}`,
        '_blank'
      );
    }

    const now = new Date();
    const entry = getBuilding(db, r.bldg);
    const apt = entry?.apts[r.idx];
    if (!apt) return;
    const interactions = [
      {
        date: `${now.toLocaleDateString('he-IL')} ${now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`,
        type: channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'מייל',
        notes: personal.substring(0, 120),
        channel,
        source: 'comm_hub',
        result: '',
      },
      ...(apt.interactions ?? []),
    ];
    setSentKeys((s) => new Set(s).add(r.key));
    await updateApt(r.bldg, r.idx, { interactions });
  };

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">מרכז תקשורת</h2>
        <span className="count">{chosen.length} נבחרו מתוך {filtered.length}</span>
        <span className="filter-pill" style={{ cursor: 'default', color: 'var(--accent)' }}>
          <i className="fas fa-paper-plane" /> {(() => {
            const cutoff = Date.now() - 30 * 86400000;
            let n = 0;
            for (const key of buildingKeys(db)) {
              liveApts(getBuilding(db, key)?.apts).forEach((a) =>
                (a.interactions ?? []).forEach((l) => {
                  if (l.source === 'comm_hub' && new Date(String(l.date ?? '')).getTime() > cutoff) n++;
                }));
            }
            return n;
          })()} הודעות נשלחו החודש
        </span>
      </div>
      <div className="card-tabs">
        {COMM_TABS.map((t) => (
          <button key={t.key} className={commTab === t.key ? 'active' : ''} onClick={() => setCommTab(t.key)}>
            <i className={`fas ${t.icon}`} /> {t.label}
          </button>
        ))}
      </div>
      {commTab === 'calls' && <CallsTab db={db} />}
      {commTab === 'history' && <HistoryTab db={db} />}
      {commTab === 'docs' && <DocsTab db={db} />}
      {commTab === 'templates' && <TemplatesTab db={db} />}
      {commTab === 'compose' && (
      <>
      <div className="table-toolbar" style={{ margin: '0 0 10px' }}>
        <div className="channel-tabs">
          <button className={channel === 'whatsapp' ? 'chan active' : 'chan'} onClick={() => setChannel('whatsapp')}>
            <i className="fab fa-whatsapp" /> וואטסאפ
          </button>
          <button className={channel === 'email' ? 'chan active' : 'chan'} onClick={() => setChannel('email')}>
            <i className="fas fa-envelope" /> מייל
          </button>
          <button className={channel === 'sms' ? 'chan active' : 'chan'} onClick={() => setChannel('sms')}>
            <i className="fas fa-sms" /> SMS
          </button>
        </div>
      </div>

      <div className="comm-layout">
        <div className="comm-compose">
          <label className="edit-field">
            <span>תבנית</span>
            <select
              className="board-select"
              defaultValue=""
              onChange={(e) => {
                const t = templates[Number(e.target.value)];
                if (t?.text) setText(t.text);
              }}
            >
              <option value="" disabled>בחר תבנית…</option>
              {templates.map((t, i) => (
                <option key={i} value={i}>{t.title}</option>
              ))}
            </select>
          </label>
          <label className="edit-field">
            <span>הודעה — ‏[שם] יוחלף בשם המשפחה</span>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="שלום משפחת [שם]…" />
          </label>
          {text && chosen[0] && (
            <p className="comm-preview"><i className="fas fa-eye" /> תצוגה מקדימה ({chosen[0].name}): {personalize(text, chosen[0].name)}</p>
          )}
          {chosen.length > 0 && text.trim() && (
            <div className="send-list">
              {chosen.map((r) => (
                <div className="send-row" key={r.key}>
                  <span>{r.name}</span>
                  {sentKeys.has(r.key) ? (
                    <span className="sent-badge">נשלח ✓</span>
                  ) : (
                    <button className={channel === 'whatsapp' ? 'save-btn wa' : 'save-btn'} onClick={() => void sendTo(r)}>
                      {channel === 'whatsapp' ? 'שליחה בוואטסאפ' : 'שליחה במייל'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="comm-recipients">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 14 }}><i className="fas fa-users" style={{ color: 'var(--accent)' }} /> קהל יעד</strong>
            <span className="count">{chosen.length === 0 ? 'לא נבחרו' : `${chosen.length} נבחרו`}</span>
          </div>
          <div className="chip-row">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.key}
                className={`aud-chip ${quickFilter === f.key ? 'active' : ''}`}
                onClick={() => setQuickFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="table-toolbar" style={{ margin: 0 }}>
            <input
              type="search"
              placeholder="חיפוש נמענים…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="board-select" value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}>
              <option value="">כל הסגנונות</option>
              {styles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="login-btn" onClick={toggleAll}>
              {selected.size === filtered.length && filtered.length > 0 ? 'נקה הכל' : 'בחר הכל'}
            </button>
          </div>
          <ul className="recipient-list">
            {filtered.map((r) => (
              <li key={r.key} className={selected.has(r.key) ? 'recipient active' : 'recipient'}>
                <label>
                  <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                  <span className="recipient-name">{r.name || r.bldg}</span>
                  <span className="recipient-meta" dir="ltr">{channel === 'whatsapp' ? r.phone : r.email}</span>
                  {r.style && <span className="recipient-style">{r.style}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      </>
      )}
      {commTab === 'compose' && (
        <p className="drawer-note" style={{ marginTop: 16 }}>
          כל שליחה נפתחת באפליקציה המתאימה עם ההודעה המותאמת, ומתועדת אוטומטית בכרטיס המשפחה —
          באותו פורמט לוג כמו המערכת הקיימת.
        </p>
      )}
    </section>
  );
}

/** טאב חיוג — כמו יומן השיחות בישן: רשימה, חיוג, תיעוד תוצאה מהיר */
function CallsTab({ db }: { db: Db }) {
  const updateApt = useCrm((s) => s.updateApt);
  const [q, setQ] = useState('');
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(new Set());

  const people = useMemo(() => {
    const out: { key: string; bldg: string; idx: number; name: string; phone: string; days: number | null }[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        const phone = a.fatherPhone || a.motherPhone || '';
        if (!phone) return;
        const latest = (a.interactions ?? []).reduce((max, i) => {
          const t = new Date(i.date ?? '').getTime();
          return isNaN(t) ? max : Math.max(max, t);
        }, 0);
        out.push({
          key: `${key}|${entry.apts.indexOf(a)}`, bldg: key, idx: entry.apts.indexOf(a),
          name: a.name || key, phone,
          days: latest ? Math.floor((Date.now() - latest) / 86400000) : null,
        });
      });
    }
    // מי שהכי מזמן לא דיברו איתו — קודם
    return out.sort((a, b) => (b.days ?? 99999) - (a.days ?? 99999));
  }, [db]);

  const logCall = async (p: (typeof people)[number], result: string) => {
    const apt = getBuilding(db, p.bldg)?.apts[p.idx];
    if (!apt) return;
    const now = new Date();
    await updateApt(p.bldg, p.idx, {
      interactions: [
        {
          date: `${now.toLocaleDateString('he-IL')} ${now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`,
          type: 'שיחה', notes: result, channel: 'phone', source: 'comm_hub', result,
        },
        ...(apt.interactions ?? []),
      ],
    });
    setLoggedKeys((s) => new Set(s).add(p.key));
  };

  const filtered = people.filter((p) => !q.trim() || p.name.includes(q.trim()) || p.phone.includes(q.trim()));

  return (
    <div className="comm-recipients" style={{ marginTop: 4 }}>
      <div className="table-toolbar" style={{ margin: 0 }}>
        <input type="search" placeholder="חיפוש לחיוג…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="count">{filtered.length} עם טלפון</span>
      </div>
      <ul className="recipient-list">
        {filtered.map((p) => (
          <li key={p.key} className="recipient">
            <div className="call-row">
              <span className="recipient-name">{p.name}</span>
              <span className="recipient-meta" dir="ltr">{p.phone}</span>
              <span className={`contact-badge ${p.days === null ? 'none' : p.days > 60 ? 'stale' : p.days > 21 ? 'aging' : 'fresh'}`}>
                {p.days === null ? 'אין תיעוד' : p.days === 0 ? 'היום' : `לפני ${p.days} י׳`}
              </span>
              <a className="close-btn" href={`tel:${p.phone}`} title="חיוג"><i className="fas fa-phone" style={{ color: 'var(--success)' }} /></a>
              {loggedKeys.has(p.key) ? (
                <span className="sent-badge">תועד ✓</span>
              ) : (
                <span className="log-btns">
                  <button onClick={() => void logCall(p, 'ענו')}>ענו</button>
                  <button onClick={() => void logCall(p, 'לא ענו')}>לא ענו</button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** טאב תיעודים — מסמכי שיחה, אותו מבנה convDocs כמו הישן */
function DocsTab({ db }: { db: Db }) {
  const updateApt = useCrm((s) => s.updateApt);
  const [q, setQ] = useState('');
  const [chanFilter, setChanFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    famKey: '', date: new Date().toISOString().slice(0, 10),
    channel: 'general', title: '', body: '',
  });

  const families = useMemo(() => {
    const out: { key: string; name: string }[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) =>
        out.push({ key: `${key}|${entry.apts.indexOf(a)}`, name: a.name || key })
      );
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [db]);

  const docs = useMemo(() => {
    const out: { name: string; date: string; channel: string; title: string; body: string }[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        (((a as Record<string, unknown>).convDocs ?? []) as Record<string, unknown>[]).forEach((d) => {
          out.push({
            name: a.name || key,
            date: String(d.date ?? ''),
            channel: String(d.channel ?? 'general'),
            title: String(d.title ?? ''),
            body: String(d.body ?? ''),
          });
        });
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [db]);

  const saveDoc = async () => {
    if (!form.famKey || !form.body.trim()) return;
    const [bldg, idxStr] = form.famKey.split('|');
    const idx = Number(idxStr);
    const apt = getBuilding(db, bldg!)?.apts[idx];
    if (!apt) return;
    // אותו מבנה בדיוק כמו saveConvDoc בישן
    const doc = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: form.date, channel: form.channel, docType: 'summary',
      title: form.title.trim(), body: form.body.trim(), recordingUrl: '',
      createdAt: Date.now(),
    };
    await updateApt(bldg!, idx, {
      convDocs: [...(((apt as Record<string, unknown>).convDocs ?? []) as unknown[]), doc],
    } as never);
    setAdding(false);
    setForm({ ...form, title: '', body: '' });
  };

  const filtered = docs.filter(
    (d) =>
      (!chanFilter || d.channel === chanFilter) &&
      (!q.trim() || [d.name, d.title, d.body].some((f) => f.includes(q.trim())))
  );

  return (
    <div className="comm-recipients" style={{ marginTop: 4 }}>
      <div className="table-toolbar" style={{ margin: 0 }}>
        <input type="search" placeholder="חיפוש בתיעודים…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="board-select" value={chanFilter} onChange={(e) => setChanFilter(e.target.value)}>
          <option value="">כל הערוצים</option>
          {Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="edit-btn" onClick={() => setAdding((v) => !v)}>
          <i className="fas fa-plus" /> תיעוד חדש
        </button>
        <span className="count">{filtered.length} תיעודים</span>
      </div>

      {adding && (
        <div className="quick-add">
          <div className="quick-add-row">
            <select className="board-select" value={form.famKey} onChange={(e) => setForm({ ...form, famKey: e.target.value })}>
              <option value="">בחר משפחה…</option>
              {families.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
            </select>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ maxWidth: 150 }} />
            <select className="board-select" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="quick-add-row">
            <input placeholder="כותרת (לא חובה)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="quick-add-row">
            <textarea
              rows={3} placeholder="סיכום השיחה…" value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }}
            />
          </div>
          <div className="quick-add-row">
            <button className="save-btn" disabled={!form.famKey || !form.body.trim()} onClick={() => void saveDoc()}>שמירת תיעוד</button>
          </div>
        </div>
      )}

      <ul className="tpl-list" style={{ maxHeight: 440, overflowY: 'auto' }}>
        {filtered.map((d, i) => (
          <li key={i}>
            <div>
              <strong>{d.name}</strong> <span className="tag-chip">{DOC_CHANNELS[d.channel] ?? d.channel}</span>
              {d.title && <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>}
              <div className="tpl-text">{d.body.slice(0, 120)}</div>
            </div>
            <span className="tpl-text" style={{ whiteSpace: 'nowrap' }}>{d.date}</span>
          </li>
        ))}
        {filtered.length === 0 && <li className="placeholder">אין תיעודים עדיין.</li>}
      </ul>
    </div>
  );
}

/** טאב היסטוריה — כל התקשורת שתועדה, עם פילטר ערוץ וחיפוש */
function HistoryTab({ db }: { db: Db }) {
  const [q, setQ] = useState('');
  const [chan, setChan] = useState('');

  const logs = useMemo(() => {
    const out: { date: string; type: string; text: string; name: string }[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        (a.interactions ?? []).forEach((l) => {
          out.push({
            date: String(l.date ?? ''), type: String(l.type ?? ''),
            text: String(l.text ?? l.notes ?? ''), name: a.name || key,
          });
        });
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [db]);

  const types = [...new Set(logs.map((l) => l.type).filter(Boolean))];
  const filtered = logs.filter(
    (l) => (!chan || l.type === chan) && (!q.trim() || l.name.includes(q.trim()) || l.text.includes(q.trim()))
  );

  return (
    <div className="comm-recipients" style={{ marginTop: 4 }}>
      <div className="table-toolbar" style={{ margin: 0 }}>
        <input type="search" placeholder="חיפוש בהיסטוריה…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="board-select" value={chan} onChange={(e) => setChan(e.target.value)}>
          <option value="">כל הערוצים</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="count">{filtered.length} תיעודים</span>
      </div>
      <ul className="tpl-list" style={{ maxHeight: 460, overflowY: 'auto' }}>
        {filtered.slice(0, 100).map((l, i) => (
          <li key={i}>
            <div>
              <strong>{l.name}</strong> <span className="tag-chip">{l.type}</span>
              <div className="tpl-text">{l.text.slice(0, 90)}</div>
            </div>
            <span className="tpl-text" style={{ whiteSpace: 'nowrap' }}>{l.date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


/** טאב תבניות — ניהול מלא כמו בישן */
function TemplatesTab({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const templates = ((db.__SETTINGS__?.templates ?? []) as { title?: string; text?: string }[]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  return (
    <div className="comm-recipients" style={{ marginTop: 4 }}>
      <ul className="tpl-list">
        {templates.map((t, i) => (
          <li key={i}>
            <div>
              <strong>{t.title}</strong>
              <div className="tpl-text">{t.text}</div>
            </div>
            <button className="close-btn" aria-label={'מחיקת ' + (t.title ?? '')} onClick={() => void updateSettings({ templates: templates.filter((_, x) => x !== i) })}>✕</button>
          </li>
        ))}
        {templates.length === 0 && <li className="placeholder">אין תבניות עדיין.</li>}
      </ul>
      <div className="quick-add">
        <div className="quick-add-row"><input placeholder="שם התבנית…" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="quick-add-row"><input placeholder="טקסט — [שם] יוחלף בשם המשפחה" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="quick-add-row">
          <button className="save-btn" disabled={!title.trim() || !text.trim()} onClick={() => {
            void updateSettings({ templates: [...templates, { title: title.trim(), text: text.trim() }] });
            setTitle(''); setText('');
          }}>שמירת תבנית</button>
        </div>
      </div>
    </div>
  );
}
