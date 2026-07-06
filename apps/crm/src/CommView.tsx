import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';
import { useCrm } from './store';

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

export function CommView({ db }: { db: Db }) {
  const updateApt = useCrm((s) => s.updateApt);
  const [query, setQuery] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');

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
        if (channel === 'whatsapp' ? !phone : !email) return;
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
        });
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [db, channel]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return recipients.filter(
      (r) =>
        (!styleFilter || r.style === styleFilter) &&
        (!q || [r.name, r.bldg, r.phone, ...r.tags].some((f) => f.includes(q)))
    );
  }, [recipients, query, styleFilter]);

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
        type: channel === 'whatsapp' ? 'WhatsApp' : 'מייל',
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
        <div className="channel-tabs">
          <button className={channel === 'whatsapp' ? 'chan active' : 'chan'} onClick={() => setChannel('whatsapp')}>WhatsApp</button>
          <button className={channel === 'email' ? 'chan active' : 'chan'} onClick={() => setChannel('email')}>מייל</button>
        </div>
        <span className="count">{chosen.length} נבחרו מתוך {filtered.length}</span>
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
            <p className="comm-preview">תצוגה מקדימה: {personalize(text, chosen[0].name)}</p>
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
      <p className="drawer-note" style={{ marginTop: 16 }}>
        כל שליחה נפתחת בוואטסאפ עם ההודעה המותאמת ומתועדת אוטומטית בכרטיס המשפחה —
        באותו פורמט לוג כמו המערכת הקיימת. מייל, SMS וקהלים שמורים — בשלב הבא.
      </p>
    </section>
  );
}
