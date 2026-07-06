import { useState } from 'react';
import type { Db } from '@shlichus/core';
import { useCrm } from './store';

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
      <p className="drawer-note" style={{ marginTop: 16 }}>
        השינויים נשמרים לענן ומשותפים עם המערכת הקיימת. הגדרות מתקדמות (קטגוריות, מיקום בית,
        מיתוג, ניקוד) — בינתיים במערכת הקיימת.
      </p>
    </section>
  );
}
