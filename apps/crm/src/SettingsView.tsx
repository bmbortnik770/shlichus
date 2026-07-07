import { useState } from 'react';
import type { Db } from '@shlichus/core';
import { mergeDb, saveLocal } from '@shlichus/core';
import { useCrm } from './store';
import { ImportCsv } from './ImportCsv';

/** ייצוא גיבוי JSON מלא — כמו exportData בישן */
function exportBackup(db: Db) {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-השליחות-שלי-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ListEditor({
  title,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="settings-card">
      <h3>{title}</h3>
      <div className="chip-row">
        {items.map((item) => (
          <span className="chip" key={item}>
            {item}
            <button
              aria-label={`הסרת ${item}`}
              onClick={() => onChange(items.filter((x) => x !== item))}
            >
              ✕
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="placeholder">אין פריטים</span>}
      </div>
      <form
        className="chip-add"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v && !items.includes(v)) onChange([...items, v]);
          setDraft('');
        }}
      >
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="login-btn">הוספה</button>
      </form>
    </div>
  );
}

/** סוגי האינטראקציה של הניקוד — ברירות המחדל של scoring.js בישן */
const DEFAULT_INTERACTION_TYPES = [
  { key: 'tefillin', label: 'הנחת תפילין', defaultScore: 15 },
  { key: 'mezuzah', label: 'בדיקת מזוזות', defaultScore: 20 },
  { key: 'visit', label: 'ביקור בית', defaultScore: 10 },
  { key: 'call', label: 'שיחת טלפון', defaultScore: 8 },
  { key: 'message', label: 'הודעה / מייל', defaultScore: 5 },
  { key: 'mourning', label: 'ניחום אבלים', defaultScore: 25 },
  { key: 'hospital', label: 'ביקור חולים', defaultScore: 20 },
  { key: 'shiur', label: 'שיעור', defaultScore: 12 },
  { key: 'event', label: 'אירוע / חג', defaultScore: 8 },
  { key: 'prayer', label: 'תפילה / מניין', defaultScore: 10 },
  { key: 'donation', label: 'תרומה', defaultScore: 6 },
];

/** מיקום בית — geocode דרך Mapbox כמו בישן, נשמר ל-homeLocation */
function HomeLocationCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const home = (db.__SETTINGS__?.homeLocation ?? {}) as { address?: string; coords?: [number, number] };
  const [addr, setAddr] = useState(home.address ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const locate = async () => {
    if (!addr.trim()) return;
    setBusy(true); setMsg('');
    try {
      const token = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr.trim())}.json?country=il&language=he&access_token=${token}`
      );
      const data = (await res.json()) as { features?: { center: [number, number]; place_name: string }[] };
      const f = data.features?.[0];
      if (!f) { setMsg('הכתובת לא נמצאה'); return; }
      await updateSettings({ homeLocation: { coords: f.center, address: f.place_name, isChabad: true } });
      setMsg(`✅ נשמר: ${f.place_name}`);
    } catch {
      setMsg('שגיאה באיתור הכתובת');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-card">
      <h3><i className="fas fa-house-chimney" /> מיקום בית / בית חב״ד</h3>
      {home.address && <p className="tpl-text">נוכחי: {home.address}</p>}
      <div className="chip-add">
        <input placeholder="כתובת מלאה…" value={addr} onChange={(e) => setAddr(e.target.value)} />
        <button className="login-btn" disabled={busy || !addr.trim()} onClick={() => void locate()}>
          {busy ? 'מאתר…' : 'אתר ושמור'}
        </button>
      </div>
      {msg && <p className="tpl-text">{msg}</p>}
    </div>
  );
}

/** מיתוג — שם השליחות + צבע ערכת נושא (themeColor כמו בישן) */
function BrandingCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const territory = (db.__SETTINGS__?.territory ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(String(territory.missionName ?? ''));
  const color = String(db.__SETTINGS__?.themeColor ?? '#3b82f6');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-paintbrush" /> מיתוג</h3>
      <label className="edit-field">
        <span>שם השליחות</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: בית חב״ד רמת אביב" />
      </label>
      <label className="edit-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <span>צבע ראשי</span>
        <input
          type="color"
          value={color}
          onChange={(e) => {
            document.documentElement.style.setProperty('--accent', e.target.value);
            void updateSettings({ themeColor: e.target.value });
          }}
          style={{ width: 46, height: 32, border: 0, background: 'none', cursor: 'pointer' }}
        />
      </label>
      <button
        className="login-btn"
        onClick={() => void updateSettings({ territory: { ...territory, missionName: name.trim() } })}
      >
        שמירת מיתוג
      </button>
    </div>
  );
}

/** הגדרות ניקוד — משקלים לסוגי אינטראקציה (interactionTypes כמו בישן) */
function ScoringCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const saved = (db.__SETTINGS__?.interactionTypes ?? []) as { key: string; label: string; defaultScore: number }[];
  const types = saved.length ? saved : DEFAULT_INTERACTION_TYPES;

  const setScore = (key: string, score: number) => {
    const next = types.map((t) => (t.key === key ? { ...t, defaultScore: score } : t));
    void updateSettings({ interactionTypes: next });
  };

  return (
    <div className="settings-card">
      <h3><i className="fas fa-star-half-stroke" /> ניקוד מעורבות — משקל לכל פעולה</h3>
      <div className="score-grid">
        {types.map((t) => (
          <label key={t.key} className="score-row">
            <span>{t.label}</span>
            <input
              type="number" min={0} max={100} dir="ltr"
              defaultValue={t.defaultScore}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v !== t.defaultScore) setScore(t.key, v);
              }}
            />
          </label>
        ))}
      </div>
      <p className="tpl-text">המשקלים משותפים עם המערכת הקיימת ומשפיעים על ציון המעורבות בשתיהן.</p>
    </div>
  );
}

/** ניהול סוגי אירועים — אותו מבנה כמו appSettings.customEventTypes בישן */
function EventTypesEditor({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const types = ((db.__SETTINGS__?.customEventTypes ?? []) as { id: string; label: string; emoji?: string; recurring?: boolean }[]);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('🎉');
  const [recurring, setRecurring] = useState(true);

  return (
    <>
      {types.length === 0 && <p className="placeholder">אין סוגים מותאמים — משתמשים במובנים.</p>}
      <ul className="tpl-list">
        {types.map((t) => (
          <li key={t.id}>
            <div><strong>{t.emoji} {t.label}</strong>{t.recurring ? <span className="tpl-text"> · חוזר שנתית</span> : null}</div>
            <button
              className="close-btn" aria-label={`מחיקת ${t.label}`}
              onClick={() => void updateSettings({ customEventTypes: types.filter((x) => x.id !== t.id) })}
            >✕</button>
          </li>
        ))}
      </ul>
      <form
        className="chip-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          void updateSettings({
            customEventTypes: [...types, { id: 'custom_' + Date.now(), label: label.trim(), emoji, color: '#3b82f6', recurring }],
          });
          setLabel('');
        }}
      >
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ maxWidth: 56, textAlign: 'center' }} />
        <input value={label} placeholder="שם סוג האירוע…" onChange={(e) => setLabel(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> חוזר
        </label>
        <button type="submit" className="login-btn">הוספה</button>
      </form>
    </>
  );
}

export function SettingsView({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const settings = db.__SETTINGS__ ?? {};
  const tags = (settings.tags ?? []) as string[];
  const styles = (settings.styles ?? []) as string[];
  const templates = (settings.templates ?? []) as { title?: string; text?: string }[];
  const [tplTitle, setTplTitle] = useState('');
  const [tplText, setTplText] = useState('');

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">הגדרות</h2>
      </div>
      <div className="settings-grid">
        <ListEditor
          title="תגיות"
          items={tags}
          placeholder="תגית חדשה…"
          onChange={(next) => void updateSettings({ tags: next })}
        />
        <ListEditor
          title="סגנונות / סטטוסים"
          items={styles}
          placeholder="סגנון חדש…"
          onChange={(next) => void updateSettings({ styles: next })}
        />
        <div className="settings-card">
          <h3>תבניות הודעה</h3>
          {templates.length === 0 && <p className="placeholder">אין תבניות</p>}
          <ul className="tpl-list">
            {templates.map((t, i) => (
              <li key={i}>
                <div>
                  <strong>{t.title}</strong>
                  <div className="tpl-text">{t.text}</div>
                </div>
                <button
                  className="close-btn"
                  aria-label={`מחיקת ${t.title}`}
                  onClick={() => void updateSettings({ templates: templates.filter((_, x) => x !== i) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="tpl-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tplTitle.trim() || !tplText.trim()) return;
              void updateSettings({ templates: [...templates, { title: tplTitle.trim(), text: tplText.trim() }] });
              setTplTitle('');
              setTplText('');
            }}
          >
            <input value={tplTitle} placeholder="שם התבנית" onChange={(e) => setTplTitle(e.target.value)} />
            <textarea rows={2} value={tplText} placeholder="טקסט — ‏[שם] יוחלף בשם המשפחה" onChange={(e) => setTplText(e.target.value)} />
            <button type="submit" className="login-btn">הוספת תבנית</button>
          </form>
        </div>
      </div>
      <div className="settings-grid" style={{ marginTop: 14 }}>
        <HomeLocationCard db={db} />
        <BrandingCard db={db} />
      </div>
      <div style={{ marginTop: 14 }}>
        <ScoringCard db={db} />
      </div>
      <div className="settings-card" style={{ marginTop: 14 }}>
        <h3>סוגי אירועים מותאמים</h3>
        <EventTypesEditor db={db} />
      </div>
      <div style={{ marginTop: 14 }}>
        <ImportCsv onDone={() => window.location.reload()} />
      </div>
      <div className="settings-card" style={{ marginTop: 14 }}>
        <h3>גיבוי ושחזור</h3>
        <div className="edit-actions">
          <button className="login-btn" onClick={() => exportBackup(db)}>
            <i className="fas fa-download" /> ייצוא גיבוי מלא (JSON)
          </button>
          <label className="login-btn" style={{ cursor: 'pointer' }}>
            <i className="fas fa-upload" /> ייבוא גיבוי
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const imported = JSON.parse(await file.text()) as Db;
                  if (!window.confirm('לייבא את הגיבוי? הוא ימוזג עם הנתונים הקיימים (שום דבר לא יימחק).')) return;
                  const merged = mergeDb(db, imported);
                  await saveLocal(merged);
                  window.location.reload();
                } catch {
                  window.alert('הקובץ אינו גיבוי תקין');
                }
              }}
            />
          </label>
        </div>
        <p className="tpl-text">הייבוא ממזג — רשומות חדשות מתווספות, קיימות מתעדכנות לפי החדש מביניהן.</p>
      </div>
      <p className="drawer-note" style={{ marginTop: 16 }}>
        השינויים נשמרים לענן ומשותפים עם המערכת הקיימת. הגדרות מתקדמות (קטגוריות, מיקום בית,
        מיתוג, ניקוד) — בינתיים במערכת הקיימת.
      </p>
    </section>
  );
}
