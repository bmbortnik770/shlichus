import { useState } from 'react';
import type { Apartment } from '@shlichus/core';
import { NO_ADDRESS_KEY } from '@shlichus/core';

interface Props {
  bldg: string;
  apt: Apartment;
  onClose: () => void;
  onSave: (patch: Partial<Apartment>) => Promise<void>;
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

  const save = async () => {
    setSaving(true);
    await onSave({
      name: form.name,
      num: form.num,
      father: form.father,
      mother: form.mother,
      fatherPhone: form.fatherPhone,
      motherPhone: form.motherPhone,
      fatherEmail: form.fatherEmail,
      style: form.style,
      notes: form.notes,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    setEditing(false);
  };

  const logs = (apt.interactions ?? []).slice(-8).reverse();
  const donations = apt.donations ?? [];
  const tasks = (apt.tasks ?? []).filter((t) => !t.done);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{apt.name || 'ללא שם'}</h2>
          <div className="drawer-actions">
            {!editing && (
              <button className="edit-btn" onClick={() => setEditing(true)}>עריכה</button>
            )}
            <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
          </div>
        </header>
        <p className="drawer-sub">
          {bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${bldg} ${apt.num ?? ''}`.trim()}
          {apt.style ? ` · ${apt.style}` : ''}
        </p>

        {editing ? (
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
              <button className="save-btn" disabled={saving} onClick={() => void save()}>
                {saving ? 'שומר…' : 'שמירה'}
              </button>
              <button className="cancel-btn" disabled={saving} onClick={() => setEditing(false)}>ביטול</button>
            </div>
          </section>
        ) : (
          <>
            <section>
              <h3>פרטים</h3>
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

            {tasks.length > 0 && (
              <section>
                <h3>משימות פתוחות ({tasks.length})</h3>
                <ul>{tasks.map((t, i) => <li key={i}>{String(t.text ?? '')}</li>)}</ul>
              </section>
            )}

            {donations.length > 0 && (
              <section>
                <h3>תרומות ({donations.length})</h3>
                <ul>
                  {donations.slice(-5).reverse().map((d, i) => (
                    <li key={i}>{d.date ?? ''} — ‏{d.amount ?? 0} ₪ {d.campaign ? `(${d.campaign})` : ''}</li>
                  ))}
                </ul>
              </section>
            )}

            {logs.length > 0 && (
              <section>
                <h3>אינטראקציות אחרונות</h3>
                <ul>
                  {logs.map((l, i) => (
                    <li key={i}><strong>{l.date ?? ''}</strong> {l.type ? `· ${l.type}` : ''} — {String(l.text ?? '')}</li>
                  ))}
                </ul>
              </section>
            )}

            <p className="drawer-note">
              עריכת פרטים זמינה כאן; אינטראקציות, תרומות ומשימות — בינתיים במערכת הקיימת.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
