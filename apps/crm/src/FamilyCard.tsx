import { useEffect, useState } from 'react';
import type { Apartment, Db, Donation, InteractionLog, Milestone, Task } from '@shlichus/core';
import { NO_ADDRESS_KEY, daysUntil, formatHebrew, getAptScore, getStatusColor, hebrewParts, nextOccurrence } from '@shlichus/core';

interface Props {
  bldg: string;
  apt: Apartment;
  db?: Db;
  onClose: () => void;
  onSave: (patch: Partial<Apartment>) => Promise<void>;
  onSplit?: (memberName: string) => Promise<void>;
}

const TABS = [
  { key: 'details', label: 'פרטים', icon: 'fa-user' },
  { key: 'activity', label: 'פעילות', icon: 'fa-bolt' },
  { key: 'donations', label: 'תרומות', icon: 'fa-hand-holding-heart' },
  { key: 'docs', label: 'תיעוד', icon: 'fa-file-lines' },
  { key: 'milestones', label: 'אבני דרך', icon: 'fa-calendar-star' },
] as const;

const DOC_CHANNELS: Record<string, string> = {
  general: 'כללי', phone: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה',
};

// סוגי ציוני דרך כמו במערכת הקיימת
const MS_TYPES = [
  { key: 'birthday', label: 'יום הולדת' },
  { key: 'yahrzeit', label: 'יארצייט' },
  { key: 'anniversary', label: 'יום נישואין' },
  { key: 'barmitzva', label: 'בר/בת מצווה' },
  { key: 'other', label: 'אחר' },
];

// סוגי אינטראקציה כמו במערכת הקיימת
const LOG_TYPES = ['שיחה', 'ביקור', 'WhatsApp', 'מייל', 'פגישה', 'אחר'];

function nowStamp(): string {
  const now = new Date();
  return `${now.toLocaleDateString('he-IL')} ${now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  );
}

function Input({ label, value, onChange, dir }: { label: string; value: string; onChange: (v: string) => void; dir?: string }) {
  return (
    <label className="edit-field">
      <span>{label}</span>
      <input value={value} dir={dir} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function FamilyCard({ bldg, apt, db, onClose, onSave, onSplit }: Props) {
  const [tab, setTab] = useState<string>('details');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // טופס חי תמיד — כמו clientModal בישן
  const [form, setForm] = useState({
    name: apt.name ?? '',
    num: apt.num ?? '',
    father: apt.father ?? '',
    mother: apt.mother ?? '',
    fatherPhone: apt.fatherPhone ?? '',
    motherPhone: apt.motherPhone ?? '',
    fatherEmail: apt.fatherEmail ?? '',
    motherEmail: apt.motherEmail ?? '',
    style: apt.style ?? '',
    notes: apt.notes ?? '',
  });
  const [tags, setTags] = useState<string[]>([...(apt.tags ?? [])]);
  const [children, setChildren] = useState<{ name?: string; phone?: string }[]>([...(apt.childrenList ?? [])]);
  const [boards, setBoards] = useState<Record<string, string>>({ ...((apt.boards ?? {}) as Record<string, string>) });
  const [custom, setCustom] = useState<Record<string, unknown>>({ ...((apt.customData ?? apt.customFields ?? {}) as Record<string, unknown>) });
  const setF = (k: keyof typeof form) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const editing = dirty; // תאימות ל-ESC עם אישור

  // טפסי הוספה מהירים
  const [logType, setLogType] = useState('שיחה');
  const [logText, setLogText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [donAmount, setDonAmount] = useState('');
  const [donCampaign, setDonCampaign] = useState('');
  const [msType, setMsType] = useState('birthday');
  const [msRecurring, setMsRecurring] = useState(true); // ספירלי כברירת מחדל כמו בישן
  const [msDateMode, setMsDateMode] = useState<'greg' | 'heb'>('greg');
  const [msHebDay, setMsHebDay] = useState(15);
  const [msHebMonth, setMsHebMonth] = useState('תשרי');
  const [msLabel, setMsLabel] = useState('');
  const [msDate, setMsDate] = useState('');
  const [docChannel, setDocChannel] = useState('general');
  const [docTitle, setDocTitle] = useState('');
  const [docBody, setDocBody] = useState('');

  const phone = apt.fatherPhone || apt.motherPhone || '';
  const wa = phone ? `https://wa.me/972${phone.replace(/\D/g, '').replace(/^0/, '')}` : '';

  // ESC סוגר — עם אישור אם באמצע עריכה (כמו התיקון במערכת הישנה)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing && !window.confirm('יש שינויים שלא נשמרו. לצאת בכל זאת?')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  const saveDetails = async () => {
    setSaving(true);
    // אותם שדות כמו saveClientWithAuthCheck בישן (customData=customFields)
    await onSave({
      ...form,
      tags, childrenList: children, boards,
      customData: custom, customFields: custom,
    } as Partial<Apartment>);
    setSaving(false);
    setDirty(false);
  };

  const addLog = async () => {
    if (!logText.trim()) return;
    setSaving(true);
    const entry: InteractionLog = { date: nowStamp(), type: logType, notes: logText.trim(), source: 'v2' };
    await onSave({ interactions: [entry, ...(apt.interactions ?? [])] });
    setLogText('');
    setSaving(false);
  };

  const addTask = async () => {
    if (!taskText.trim()) return;
    setSaving(true);
    const t: Task = { text: taskText.trim(), due: taskDue, done: false };
    await onSave({ tasks: [...(apt.tasks ?? []), t] });
    setTaskText(''); setTaskDue('');
    setSaving(false);
  };

  const toggleTask = async (idx: number) => {
    const tasks = (apt.tasks ?? []).map((t, i) => (i === idx ? { ...t, done: !t.done } : t));
    await onSave({ tasks });
  };

  const addMilestone = async () => {
    let gregDateStr = msDate;
    let h = null as ReturnType<typeof hebrewParts>;
    if (msDateMode === 'heb') {
      // הזנת תאריך עברי ישירות — מחושב המופע הבא בלוח
      const next = nextOccurrence(msHebMonth, msHebDay);
      if (!next) { window.alert('תאריך עברי לא תקין'); return; }
      gregDateStr = next.toISOString().slice(0, 10);
      h = { day: msHebDay, monthName: msHebMonth, year: 0 };
    } else {
      if (!msDate) return;
      h = hebrewParts(new Date(msDate + 'T12:00:00'));
      if (!h) { window.alert('תאריך לא תקין'); return; }
    }
    const msDateFinal = gregDateStr;
    setSaving(true);
    const typeLabel = MS_TYPES.find((t) => t.key === msType)?.label ?? msType;
    const m: Milestone = {
      id: Date.now(),
      type: msType,
      label: msLabel.trim() || `${typeLabel} — ${apt.name ?? ''}`,
      monthName: h.monthName,
      day: h.day,
      gregDate: msDateFinal,
      recurring: msRecurring,
    };
    await onSave({ milestones: [...(apt.milestones ?? []), m] });
    setMsLabel(''); setMsDate('');
    setSaving(false);
  };

  const removeMilestone = async (id: unknown) => {
    if (!window.confirm('להסיר את ציון הדרך?')) return;
    await onSave({ milestones: (apt.milestones ?? []).filter((m) => (m as { id?: unknown }).id !== id) });
  };

  const markDeceased = async () => {
    const who = window.prompt('מי נפטר/ה? (אב / אם / שם אחר)');
    if (!who) return;
    const date = window.prompt('תאריך פטירה לועזי (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!date) return;
    const h = hebrewParts(new Date(date + 'T12:00:00'));
    const milestones = [...(apt.milestones ?? [])];
    if (h) {
      milestones.push({
        id: Date.now(), type: 'yahrzeit',
        label: `יארצייט ${who} — ${apt.name ?? ''}`,
        monthName: h.monthName, day: h.day, gregDate: date, autoCreated: true,
      } as Milestone);
    }
    await onSave({
      lifeStatus: 'deceased',
      deceasedInfo: { who, date, recordedAt: new Date().toISOString() },
      milestones,
    } as Partial<Apartment>);
  };

  const restoreActive = async () => {
    await onSave({ lifeStatus: '', deceasedInfo: undefined } as Partial<Apartment>);
  };

  const addDoc = async () => {
    if (!docBody.trim()) return;
    setSaving(true);
    // אותו מבנה בדיוק כמו saveConvDoc בישן
    const doc = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString().slice(0, 10),
      channel: docChannel, docType: 'summary',
      title: docTitle.trim(), body: docBody.trim(), recordingUrl: '',
      createdAt: Date.now(),
    };
    const existing = ((apt as Record<string, unknown>).convDocs ?? []) as unknown[];
    await onSave({ convDocs: [...existing, doc] } as never);
    setDocTitle(''); setDocBody('');
    setSaving(false);
  };

  const addDonation = async () => {
    const amount = Number(donAmount);
    if (!amount) return;
    setSaving(true);
    const d: Donation = { date: new Date().toISOString().slice(0, 10), amount, campaign: donCampaign.trim() };
    await onSave({ donations: [...(apt.donations ?? []), d] });
    setDonAmount(''); setDonCampaign('');
    setSaving(false);
  };

  const logs = (apt.interactions ?? []).slice(0, 20);
  const tasks = apt.tasks ?? [];
  const donations = [...(apt.donations ?? [])].reverse();
  const donTotal = donations.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2><i className="fas fa-id-card" style={{ color: 'var(--accent)', marginInlineEnd: 8 }} />{apt.name || 'ללא שם'}</h2>
          <div className="drawer-actions">
            {phone && (
              <>
                <a className="close-btn" href={`tel:${phone}`} title="חיוג"><i className="fas fa-phone" style={{ color: 'var(--success)' }} /></a>
                <a className="close-btn" href={wa} target="_blank" rel="noreferrer" title="וואטסאפ"><i className="fab fa-whatsapp" style={{ color: '#25D366' }} /></a>
              </>
            )}
            <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
          </div>
        </header>
        <div className="chip-row" style={{ marginBottom: 8 }}>
          {(() => {
            const score = getAptScore(apt, db?.__SETTINGS__);
            const color = getStatusColor(apt, db?.__SETTINGS__);
            const label = score < 0 ? 'אין קשר' : color === '#10b981' ? `${score} — חם 🔥` : color === '#f59e0b' ? `${score} — פושר 🌤️` : `${score} — קר ❄️`;
            return <span className="contact-badge" style={{ background: color + '22', color }}>{label}</span>;
          })()}
          {(() => {
            const latest = (apt.interactions ?? []).reduce((max, i) => {
              const t = new Date(i.date ?? '').getTime();
              return isNaN(t) ? max : Math.max(max, t);
            }, 0);
            if (!latest) return <span className="contact-badge none">אין תיעוד</span>;
            const days = Math.floor((Date.now() - latest) / 86400000);
            return <span className="contact-badge fresh"><i className="fas fa-history" /> {days === 0 ? 'היום' : `לפני ${days} ימים`}</span>;
          })()}
        </div>
        <p className="drawer-sub">
          {bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${bldg} ${apt.num ?? ''}`.trim()}
          {apt.style ? ` · ${apt.style}` : ''}
        </p>

        <div className="heb-today">
          <i className="fas fa-calendar" /> היום: {(() => {
            const h = hebrewParts(new Date());
            return h ? `${formatHebrew(h.day, h.monthName)} ${h.year ? '' : ''}` : '';
          })()}
          {(() => {
            const latest = (apt.interactions ?? []).reduce((max, i) => {
              const t = new Date(i.date ?? '').getTime();
              return isNaN(t) ? max : Math.max(max, t);
            }, 0);
            const days = latest ? Math.floor((Date.now() - latest) / 86400000) : null;
            return (
              <span className={`contact-badge ${days === null ? 'none' : days > 60 ? 'stale' : days > 21 ? 'aging' : 'fresh'}`} style={{ marginInlineStart: 'auto' }}>
                {days === null ? 'אין תיעוד קשר' : days === 0 ? 'קשר היום' : `קשר לפני ${days} י׳`}
              </span>
            );
          })()}
        </div>
        <div className="card-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <i className={`fas ${t.icon}`} /> {t.label}
            </button>
          ))}
        </div>

        {(apt as { lifeStatus?: string }).lifeStatus === 'deceased' && (
          <div className="deceased-banner">
            <i className="fas fa-candle-holder" /> ‏
            {String((apt as { deceasedInfo?: { who?: string } }).deceasedInfo?.who ?? '')} ע״ה
            <button className="cancel-btn" style={{ padding: '3px 12px', fontSize: 12 }} onClick={() => void restoreActive()}>
              החזרה לסטטוס פעיל
            </button>
          </div>
        )}

        {tab === 'details' && (
          <section className="edit-form">
            <div className="form-grid">
              <Input label="שם משפחה" value={form.name} onChange={setF('name')} />
              <Input label="דירה" value={form.num} onChange={setF('num')} />
              <Input label="שם האב" value={form.father} onChange={setF('father')} />
              <Input label="טלפון אב" value={form.fatherPhone} onChange={setF('fatherPhone')} dir="ltr" />
              <Input label="שם האם" value={form.mother} onChange={setF('mother')} />
              <Input label="טלפון אם" value={form.motherPhone} onChange={setF('motherPhone')} dir="ltr" />
              <Input label="מייל אב" value={form.fatherEmail} onChange={setF('fatherEmail')} dir="ltr" />
              <Input label="מייל אם" value={form.motherEmail} onChange={setF('motherEmail')} dir="ltr" />
              <label className="edit-field">
                <span>סגנון</span>
                <select className="board-select" value={form.style} onChange={(e) => setF('style')(e.target.value)}>
                  <option value=""></option>
                  {((db?.__SETTINGS__?.styles ?? []) as string[]).map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              {((db?.__SETTINGS__?.customFields ?? []) as string[]).map((f) => (
                <Input key={f} label={f} value={String(custom[f] ?? '')} onChange={(v) => { setCustom((c) => ({ ...c, [f]: v })); setDirty(true); }} />
              ))}
            </div>

            <label className="edit-field">
              <span>תגיות</span>
              <div className="chip-row">
                {((db?.__SETTINGS__?.tags ?? []) as string[]).map((t) => (
                  <button
                    key={t} type="button"
                    className={'tag-bubble ' + (tags.includes(t) ? 'active' : '')}
                    onClick={() => { setTags((x) => x.includes(t) ? x.filter((y) => y !== t) : [...x, t]); setDirty(true); }}
                  >{t}</button>
                ))}
              </div>
            </label>

            <label className="edit-field">
              <span>ילדים</span>
              {children.map((c, i) => (
                <div className="quick-add-row" key={i}>
                  <input placeholder="שם" value={c.name ?? ''} onChange={(e) => { setChildren((arr) => arr.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x)); setDirty(true); }} />
                  <input placeholder="טלפון" dir="ltr" value={c.phone ?? ''} onChange={(e) => { setChildren((arr) => arr.map((x, xi) => xi === i ? { ...x, phone: e.target.value } : x)); setDirty(true); }} />
                  <button type="button" className="chip-x" onClick={() => { setChildren((arr) => arr.filter((_, xi) => xi !== i)); setDirty(true); }}>✕</button>
                </div>
              ))}
              <button type="button" className="login-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { setChildren((arr) => [...arr, { name: '', phone: '' }]); setDirty(true); }}>
                <i className="fas fa-plus" /> הוסף ילד/ה
              </button>
            </label>

            {(db?.__BOARDS__ ?? []).filter((b) => !b.archived).length > 0 && (
              <label className="edit-field">
                <span>שיוך ללוחות פרויקטים</span>
                <div className="chip-row">
                  {(db!.__BOARDS__ ?? []).filter((b) => !b.archived).map((b) => (
                    <button
                      key={b.id} type="button"
                      className={'tag-bubble ' + (boards[b.id] ? 'active' : '')}
                      onClick={() => {
                        setBoards((x) => {
                          const n = { ...x };
                          if (n[b.id]) delete n[b.id]; else n[b.id] = b.columns[0] ?? '';
                          return n;
                        });
                        setDirty(true);
                      }}
                    >{b.name}</button>
                  ))}
                </div>
              </label>
            )}

            <label className="edit-field">
              <span>הערות פנימיות</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setF('notes')(e.target.value)} />
            </label>

            <div className="edit-actions">
              <button className="save-btn" disabled={saving || !dirty} onClick={() => void saveDetails()}>
                {saving ? 'שומר…' : dirty ? 'שמור שינויים' : 'נשמר ✓'}
              </button>
              {(apt as { lifeStatus?: string }).lifeStatus !== 'deceased' && (
                <button className="cancel-btn" onClick={() => void markDeceased()}>
                  <i className="fas fa-candle-holder" /> תיעוד פטירה
                </button>
              )}
              {onSplit && (
                <button
                  className="cancel-btn"
                  onClick={() => {
                    const name = window.prompt('שם בן/בת המשפחה לכרטיס הנפרד:');
                    if (name?.trim()) void onSplit(name.trim());
                  }}
                >
                  <i className="fas fa-people-arrows" /> פיצול כרטיס
                </button>
              )}
            </div>
          </section>
        )}

        {tab === 'activity' && (
          <>
            <section className="quick-add">
              <div className="quick-add-row">
                <select className="board-select" value={logType} onChange={(e) => setLogType(e.target.value)}>
                  {LOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  placeholder="מה קרה? תיעוד קצר…"
                  value={logText}
                  onChange={(e) => setLogText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addLog(); }}
                />
                <button className="edit-btn" disabled={saving || !logText.trim()} onClick={() => void addLog()}>תעד</button>
              </div>
            </section>

          <>
            <section className="quick-add">
              <div className="quick-add-row">
                <input
                  placeholder="משימה חדשה…"
                  value={taskText}
                  onChange={(e) => setTaskText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addTask(); }}
                />
                <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} style={{ maxWidth: 150 }} />
                <button className="edit-btn" disabled={saving || !taskText.trim()} onClick={() => void addTask()}>הוסף</button>
              </div>
            </section>
            <section>
              <h3>משימות ({tasks.filter((t) => !t.done).length} פתוחות)</h3>
              {tasks.length === 0 ? <p className="placeholder">אין משימות.</p> : (
                <ul className="task-list">
                  {tasks.map((t, i) => (
                    <li key={i} className={t.done ? 'task done' : 'task'}>
                      <label>
                        <input type="checkbox" checked={!!t.done} onChange={() => void toggleTask(i)} />
                        <span className="task-text">{String(t.text ?? '')}</span>
                      </label>
                      {(t.due || t.date) ? <span className="task-meta">{String(t.due ?? t.date)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        
            <section>
              <h3>יומן פעילות ({logs.length})</h3>
              {logs.length === 0 ? <p className="placeholder">אין תיעוד עדיין — התיעוד הראשון במרחק שורה אחת למעלה.</p> : (
                <ul>
                  {logs.map((l, i) => (
                    <li key={i}><strong>{l.date ?? ''}</strong> {l.type ? `· ${l.type}` : ''} — {String(l.text ?? l.notes ?? '')}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === 'milestones' && (
          <>
            <div className="channel-tabs" style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
              <button className={msRecurring ? 'chan active' : 'chan'} onClick={() => setMsRecurring(true)}>🔄 ספירלי</button>
              <button className={!msRecurring ? 'chan active' : 'chan'} onClick={() => setMsRecurring(false)}>📌 חד פעמי</button>
            </div>
            <section className="quick-add">
              <div className="quick-add-row">
                <select className="board-select" value={msType} onChange={(e) => setMsType(e.target.value)}>
                  {MS_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <span className="channel-tabs">
                  <button className={msDateMode === 'greg' ? 'chan active' : 'chan'} onClick={() => setMsDateMode('greg')}>📅 לועזי</button>
                  <button className={msDateMode === 'heb' ? 'chan active' : 'chan'} onClick={() => setMsDateMode('heb')}>🗓️ עברי</button>
                </span>
              </div>
              <div className="quick-add-row">
                {msDateMode === 'greg' ? (
                  <input type="date" value={msDate} onChange={(e) => setMsDate(e.target.value)} style={{ maxWidth: 150 }} />
                ) : (
                  <>
                    <select className="board-select" value={msHebDay} onChange={(e) => setMsHebDay(Number(e.target.value))}>
                      {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{formatHebrew(d, '').trim()}</option>)}
                    </select>
                    <select className="board-select" value={msHebMonth} onChange={(e) => setMsHebMonth(e.target.value)}>
                      {['תשרי','חשוון','כסלו','טבת','שבט','אדר','אדר א׳','אדר ב׳','ניסן','אייר','סיוון','תמוז','אב','אלול'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </>
                )}
                <input placeholder="תיאור (לא חובה)" value={msLabel} onChange={(e) => setMsLabel(e.target.value)} />
                <button className="edit-btn" disabled={saving || (msDateMode === 'greg' && !msDate)} onClick={() => void addMilestone()}>הוסף</button>
              </div>
              <p className="tpl-text">התאריך העברי מחושב אוטומטית והאירוע חוזר כל שנה לפי הלוח העברי.</p>
            </section>
            <section>
              <h3>ציוני דרך ({(apt.milestones ?? []).length})</h3>
              {(apt.milestones ?? []).length === 0 ? <p className="placeholder">אין ציוני דרך.</p> : (
                <ul className="task-list">
                  {(apt.milestones ?? []).map((m, i) => {
                    const ms = m as { id?: unknown; label?: string; day?: number; monthName?: string };
                    const days = ms.day && ms.monthName ? daysUntil(ms.monthName, ms.day) : null;
                    return (
                      <li key={i} className="task">
                        <span className="task-text">
                          {String(ms.label ?? '')}
                          {ms.day && ms.monthName ? ` · ${formatHebrew(ms.day, ms.monthName)}` : ''}
                        </span>
                        <span className="task-meta">
                          {days !== null && (days === 0 ? 'היום!' : `בעוד ${days} ימים`)}
                          <button className="chip-x" title="הסרה" onClick={() => void removeMilestone(ms.id)}>✕</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === 'docs' && (
          <>
            <section className="quick-add">
              <div className="quick-add-row">
                <select className="board-select" value={docChannel} onChange={(e) => setDocChannel(e.target.value)}>
                  {Object.entries(DOC_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input placeholder="כותרת (לא חובה)" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
              </div>
              <div className="quick-add-row">
                <input
                  placeholder="סיכום השיחה…" value={docBody}
                  onChange={(e) => setDocBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addDoc(); }}
                />
                <button className="edit-btn" disabled={saving || !docBody.trim()} onClick={() => void addDoc()}>שמור</button>
              </div>
            </section>
            <section>
              <h3>מסמכי שיחה ({(((apt as Record<string, unknown>).convDocs ?? []) as unknown[]).length})</h3>
              {((((apt as Record<string, unknown>).convDocs ?? []) as Record<string, unknown>[])).length === 0 ? (
                <p className="placeholder">אין תיעודים עדיין.</p>
              ) : (
                <ul>
                  {[...(((apt as Record<string, unknown>).convDocs ?? []) as Record<string, unknown>[])].reverse().map((d, i) => (
                    <li key={i}>
                      <strong>{String(d.date ?? '')}</strong> · {DOC_CHANNELS[String(d.channel)] ?? String(d.channel ?? '')}
                      {d.title ? ` · ${String(d.title)}` : ''} — {String(d.body ?? '').slice(0, 100)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === 'donations' && (
          <>
            <section className="quick-add">
              <div className="quick-add-row">
                <input type="number" placeholder="סכום ₪" value={donAmount} onChange={(e) => setDonAmount(e.target.value)} style={{ maxWidth: 110 }} dir="ltr" />
                <input placeholder="קמפיין (לא חובה)" value={donCampaign} onChange={(e) => setDonCampaign(e.target.value)} />
                <button className="edit-btn" disabled={saving || !Number(donAmount)} onClick={() => void addDonation()}>הוסף תרומה</button>
              </div>
            </section>
            <section>
              <h3>תרומות ({donations.length}) · סה״כ {donTotal.toLocaleString('he-IL')} ₪</h3>
              {donations.length === 0 ? <p className="placeholder">אין תרומות מתועדות.</p> : (
                <ul>
                  {donations.map((d, i) => (
                    <li key={i}>{d.date ?? ''} — ‏<strong>{Number(d.amount ?? 0).toLocaleString('he-IL')} ₪</strong> {d.campaign ? `(${d.campaign})` : ''}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
