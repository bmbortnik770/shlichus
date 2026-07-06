import { useEffect, useState } from 'react';
import type { Apartment, Donation, InteractionLog, Task } from '@shlichus/core';
import { NO_ADDRESS_KEY } from '@shlichus/core';

interface Props {
  bldg: string;
  apt: Apartment;
  onClose: () => void;
  onSave: (patch: Partial<Apartment>) => Promise<void>;
}

const TABS = [
  { key: 'details', label: 'פרטים', icon: 'fa-user' },
  { key: 'activity', label: 'פעילות', icon: 'fa-bolt' },
  { key: 'tasks', label: 'משימות', icon: 'fa-check-double' },
  { key: 'donations', label: 'תרומות', icon: 'fa-hand-holding-heart' },
] as const;

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

export function FamilyCard({ bldg, apt, onClose, onSave }: Props) {
  const [tab, setTab] = useState<string>('details');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: apt.name ?? '',
    num: apt.num ?? '',
    father: apt.father ?? '',
    mother: apt.mother ?? '',
    fatherPhone: apt.fatherPhone ?? '',
    motherPhone: apt.motherPhone ?? '',
    fatherEmail: apt.fatherEmail ?? '',
    style: apt.style ?? '',
    notes: apt.notes ?? '',
    tags: (apt.tags ?? []).join(', '),
  });
  const setF = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // טפסי הוספה מהירים
  const [logType, setLogType] = useState('שיחה');
  const [logText, setLogText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [donAmount, setDonAmount] = useState('');
  const [donCampaign, setDonCampaign] = useState('');

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
    await onSave({
      name: form.name, num: form.num, father: form.father, mother: form.mother,
      fatherPhone: form.fatherPhone, motherPhone: form.motherPhone, fatherEmail: form.fatherEmail,
      style: form.style, notes: form.notes,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    setEditing(false);
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
        <p className="drawer-sub">
          {bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${bldg} ${apt.num ?? ''}`.trim()}
          {apt.style ? ` · ${apt.style}` : ''}
        </p>

        <div className="card-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <i className={`fas ${t.icon}`} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'details' && !editing && (
          <>
            <section>
              <Field label="אב" value={apt.father} />
              <Field label="טלפון אב" value={apt.fatherPhone} />
              <Field label="אם" value={apt.mother} />
              <Field label="טלפון אם" value={apt.motherPhone} />
              <Field label="מייל" value={apt.fatherEmail || apt.motherEmail} />
              <Field label="הערות" value={apt.notes} />
              {(apt.tags?.length ?? 0) > 0 && <Field label="תגיות" value={apt.tags!.join(' · ')} />}
              {(apt.childrenList?.length ?? 0) > 0 && (
                <Field label="ילדים" value={apt.childrenList!.map((c) => c.name).filter(Boolean).join(', ')} />
              )}
            </section>
            <button className="edit-btn" onClick={() => setEditing(true)}>
              <i className="fas fa-pen" /> עריכת פרטים
            </button>
          </>
        )}

        {tab === 'details' && editing && (
          <section className="edit-form">
            <Input label="שם משפחה" value={form.name} onChange={setF('name')} />
            <Input label="דירה" value={form.num} onChange={setF('num')} />
            <Input label="אב" value={form.father} onChange={setF('father')} />
            <Input label="טלפון אב" value={form.fatherPhone} onChange={setF('fatherPhone')} dir="ltr" />
            <Input label="אם" value={form.mother} onChange={setF('mother')} />
            <Input label="טלפון אם" value={form.motherPhone} onChange={setF('motherPhone')} dir="ltr" />
            <Input label="מייל" value={form.fatherEmail} onChange={setF('fatherEmail')} dir="ltr" />
            <Input label="סגנון" value={form.style} onChange={setF('style')} />
            <Input label="תגיות (מופרדות בפסיק)" value={form.tags} onChange={setF('tags')} />
            <label className="edit-field">
              <span>הערות</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setF('notes')(e.target.value)} />
            </label>
            <div className="edit-actions">
              <button className="save-btn" disabled={saving} onClick={() => void saveDetails()}>
                {saving ? 'שומר…' : 'שמירה'}
              </button>
              <button className="cancel-btn" disabled={saving} onClick={() => setEditing(false)}>ביטול</button>
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

        {tab === 'tasks' && (
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
