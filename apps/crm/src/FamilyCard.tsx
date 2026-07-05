import type { Apartment } from '@shlichus/core';
import { NO_ADDRESS_KEY } from '@shlichus/core';

interface Props {
  bldg: string;
  apt: Apartment;
  onClose: () => void;
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

export function FamilyCard({ bldg, apt, onClose }: Props) {
  const logs = (apt.interactions ?? []).slice(-8).reverse();
  const donations = apt.donations ?? [];
  const tasks = (apt.tasks ?? []).filter((t) => !t.done);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{apt.name || 'ללא שם'}</h2>
          <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
        </header>
        <p className="drawer-sub">
          {bldg === NO_ADDRESS_KEY ? 'ללא כתובת' : `${bldg} ${apt.num ?? ''}`.trim()}
          {apt.style ? ` · ${apt.style}` : ''}
        </p>

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

        <p className="drawer-note">עריכה — בשלב הבא של ההגירה. בינתיים עורכים במערכת הקיימת.</p>
      </aside>
    </div>
  );
}
