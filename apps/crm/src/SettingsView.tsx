import { useState } from 'react';
import type { Db } from '@shlichus/core';
import { DEFAULT_SCORING_RULES, type ScoringRules, mergeDb, saveLocal } from '@shlichus/core';
import { useCrm } from './store';
import { ImportCsv } from './ImportCsv';
import { alertDialog, confirmDialog } from './dialog';
import { TerritoryEditor } from './TerritoryEditor';
import { browserTokens } from './auth';

/* מבנה זהה למודל ההגדרות הישן: מיקום מרכזי → אזור השליחות → מראה ותצוגה →
   תגיות/סגנונות/שדות → גיבוי → ניקוד מעורבות → קמפיינים → ניקוד וסימון אוטומטי */

function exportBackup(db: Db) {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-השליחות-שלי-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const MAPBOX_TOKEN = 'pk.eyJ1IjoiYm1ib3J0bmlrIiwiYSI6ImNtbWl0cGNxNDAxa3kycHNhbWJ4dTR4ZWEifQ.ZxzC27qBStO30yyu60X9eQ';

/** 1. מיקום מרכזי במפה — רדיו בית חב"ד/אחר כמו בישן */
function HomeLocationCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const home = (db.__SETTINGS__?.homeLocation ?? {}) as { address?: string; coords?: [number, number]; isChabad?: boolean };
  const [locType, setLocType] = useState<'chabad' | 'other'>(home.isChabad === false ? 'other' : 'chabad');
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const locate = async () => {
    if (!addr.trim()) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr.trim())}.json?country=il&language=he&access_token=${MAPBOX_TOKEN}`
      );
      const data = (await res.json()) as { features?: { center: [number, number]; place_name: string }[] };
      const f = data.features?.[0];
      if (!f) { setMsg('הכתובת לא נמצאה — נסה לדייק'); return; }
      await updateSettings({
        primaryLocation: { coords: f.center, address: f.place_name },
        homeLocation: { coords: f.center, address: f.place_name, isChabad: locType === 'chabad' },
      });
      setMsg('הכתובת עודכנה ונשמרה!');
      setEditing(false);
    } catch { setMsg('שגיאה באיתור הכתובת'); } finally { setBusy(false); }
  };

  return (
    <div className="settings-card">
      <h3><i className="fas fa-map-marker-alt" /> מיקום מרכזי במפה</h3>
      <label className="radio-row">
        <input type="radio" name="locType" checked={locType === 'chabad'} onChange={() => setLocType('chabad')} />
        <strong>בית חב״ד</strong>
        <button className="login-btn" style={{ padding: '4px 10px', fontSize: 12, marginInlineStart: 'auto' }} onClick={() => setEditing(true)}>
          <i className="fas fa-pen" /> שנה כתובת
        </button>
      </label>
      <p className="tpl-text" style={{ marginInlineStart: 26 }}>כתובת נוכחית: <strong>{home.address ?? 'לא הוגדר'}</strong></p>
      <label className="radio-row">
        <input type="radio" name="locType" checked={locType === 'other'} onChange={() => { setLocType('other'); setEditing(true); }} />
        אחר
      </label>
      {editing && (
        <div className="chip-add">
          <input placeholder="חפש את הכתובת הקבועה…" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <button className="login-btn" disabled={busy || !addr.trim()} onClick={() => void locate()}>
            {busy ? 'מאתר…' : 'שמור'}
          </button>
        </div>
      )}
      {msg && <p className="tpl-text">{msg}</p>}
    </div>
  );
}

/** 2. הגדרות מקום השליחות — ווידג'טים כמו shlichutAreaDetails בישן */
function polygonAreaKm2(pts: [number, number][]): number {
  if (!pts || pts.length < 3) return 0;
  const R = 6371;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    area += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

function TerritoryCard({ db }: { db: Db }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const updateSettings = useCrm((s) => s.updateSettings);
  const territory = (db.__SETTINGS__?.territory ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(String(territory.missionName ?? ''));
  const [drawMode, setDrawMode] = useState(String(territory.drawMode ?? 'manual'));
  const polygon = (territory.polygon ?? []) as [number, number][];
  const hasPolygon = polygon.length >= 3;
  const km2 = polygonAreaKm2(polygon);
  const displayMode = String(territory.displayMode ?? 'border');

  const saveTerritory = (patch: Record<string, unknown>) =>
    void updateSettings({ territory: { ...territory, ...patch } });

  return (
    <div className="settings-card">
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="fas fa-draw-polygon" /> הגדרות מקום השליחות
        {hasPolygon && <span className="ok-badge">מוגדר</span>}
      </h3>
      <label className="edit-field">
        <span><i className="fas fa-tag" /> שם מקום השליחות</span>
        <input
          value={name} placeholder="למשל: בית חב״ד רעננה…"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveTerritory({ missionName: name.trim() })}
        />
      </label>

      <span className="tpl-text"><i className="fas fa-vector-square" /> תיחום אזור השליחות</span>
      <div className="mode-row">
        <label className={'mode-box' + (drawMode !== 'manual' ? ' active' : '')}>
          <input type="radio" name="drawMode" checked={drawMode !== 'manual'} onChange={() => { setDrawMode('city'); saveTerritory({ drawMode: 'city' }); }} />
          <span><strong>🏙️ עיר / יישוב</strong><br /><small>תיחום אוטומטי</small></span>
        </label>
        <label className={'mode-box' + (drawMode === 'manual' ? ' active' : '')}>
          <input type="radio" name="drawMode" checked={drawMode === 'manual'} onChange={() => { setDrawMode('manual'); saveTerritory({ drawMode: 'manual' }); }} />
          <span><strong>✏️ ציור ידני</strong><br /><small>שכונה / תת-שכונה</small></span>
        </label>
      </div>

      <button className="login-btn" id="btnOpenTerritoryEditor" style={{ borderColor: '#10b981', color: '#10b981' }} onClick={() => setEditorOpen(true)}>
        <i className="fas fa-draw-polygon" /> {hasPolygon ? 'עריכת התיחום במפה' : 'פתח עורך תיחום'}
      </button>

      {hasPolygon && (
        <div className="area-card">
          <i className="fas fa-check-circle" style={{ color: '#10b981', fontSize: 18 }} />
          <span>
            <strong>אזור מתוחם</strong><br />
            <small>שטח: <strong style={{ color: '#10b981' }}>{km2 < 1 ? (km2 * 100).toFixed(1) + ' דונם' : km2.toFixed(2) + ' קמ״ר'}</strong></small>
          </span>
          <button
            className="cancel-btn" style={{ marginInlineStart: 'auto', color: 'var(--danger)', borderColor: 'var(--danger)', padding: '4px 12px', fontSize: 12 }}
            onClick={() => { void (async () => { if (await confirmDialog('הסרת תיחום', 'להסיר את תיחום השליחות?', true)) saveTerritory({ polygon: undefined }); })(); }}
          >
            <i className="fas fa-trash" /> נקה
          </button>
        </div>
      )}

      <span className="tpl-text"><i className="fas fa-eye" /> תצוגת גבול על המפה</span>
      <div className="mode-row">
        {[['border', 'קו גבול'], ['fill', 'מילוי עדין'], ['none', 'ללא']].map(([k, v]) => (
          <label key={k} className={'mode-box small' + (displayMode === k ? ' active' : '')}>
            <input type="radio" name="dispMode" checked={displayMode === k} onChange={() => saveTerritory({ displayMode: k })} />
            {v}
          </label>
        ))}
      </div>
      {editorOpen && <TerritoryEditor db={db} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}

/** 3. מראה ותצוגה — צבע נושא + מסך פתיחה, כמו בישן */
function AppearanceCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const color = String(db.__SETTINGS__?.themeColor ?? '#3b82f6');
  const defaultView = String(db.__SETTINGS__?.defaultView ?? 'map');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-palette" /> מראה ותצוגה</h3>
      <label className="edit-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <span>צבע נושא</span>
        <input
          type="color" value={color}
          onChange={(e) => {
            document.documentElement.style.setProperty('--accent', e.target.value);
            void updateSettings({ themeColor: e.target.value });
          }}
          style={{ width: 46, height: 32, border: 0, background: 'none', cursor: 'pointer' }}
        />
      </label>
      <label className="edit-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <span>מסך פתיחה</span>
        <select className="board-select" value={defaultView} onChange={(e) => void updateSettings({ defaultView: e.target.value })}>
          <option value="map">מפה</option>
          <option value="table">טבלה</option>
          <option value="kanban">פרויקטים</option>
        </select>
      </label>
    </div>
  );
}

/** 4א. תגיות (עם צבע) */
function TagsCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const tags = (db.__SETTINGS__?.tags ?? []) as string[];
  const tagColors = (db.__SETTINGS__?.tagColors ?? {}) as Record<string, string>;
  const [draft, setDraft] = useState('');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-tags" /> ניהול תגיות</h3>
      <div className="chip-row">
        {tags.map((t) => (
          <span className="chip" key={t}>
            <input
              type="color" value={tagColors[t] ?? '#3b82f6'} title="צבע התגית"
              onChange={(e) => void updateSettings({ tagColors: { ...tagColors, [t]: e.target.value } })}
              style={{ width: 18, height: 18, border: 0, padding: 0, background: 'none', cursor: 'pointer' }}
            />
            {t}
            <button aria-label={`הסרת ${t}`} onClick={() => void updateSettings({ tags: tags.filter((x) => x !== t) })}>✕</button>
          </span>
        ))}
        {tags.length === 0 && <span className="placeholder">אין תגיות</span>}
      </div>
      <form className="chip-add" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v && !tags.includes(v)) void updateSettings({ tags: [...tags, v] }); setDraft(''); }}>
        <input value={draft} placeholder="שם תגית…" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="login-btn">הוסף</button>
      </form>
    </div>
  );
}

/** 4ב. סגנונות וצבעים — כולל setItemColor כמו בישן */
function StylesCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];
  const styleColors = (db.__SETTINGS__?.styleColors ?? {}) as Record<string, string>;
  const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];
  const [draft, setDraft] = useState('');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-palette" /> ניהול סגנונות וצבעים</h3>
      <div className="chip-row">
        {styles.map((s, i) => (
          <span className="chip" key={s}>
            <input
              type="color" value={styleColors[s] ?? CHART_COLORS[i % CHART_COLORS.length]} title="צבע הסגנון"
              onChange={(e) => void updateSettings({ styleColors: { ...styleColors, [s]: e.target.value } })}
              style={{ width: 18, height: 18, border: 0, padding: 0, background: 'none', cursor: 'pointer' }}
            />
            {s}
            <button aria-label={`הסרת ${s}`} onClick={() => void updateSettings({ styles: styles.filter((x) => x !== s) })}>✕</button>
          </span>
        ))}
      </div>
      <form className="chip-add" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v && !styles.includes(v)) void updateSettings({ styles: [...styles, v] }); setDraft(''); }}>
        <input value={draft} placeholder="סגנון חדש…" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="login-btn">הוסף</button>
      </form>
    </div>
  );
}

/** 4ג. שדות אישיים למשפחה — customFields כמו בישן */
function CustomFieldsCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const fields = (db.__SETTINGS__?.customFields ?? []) as string[];
  const [draft, setDraft] = useState('');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-list-alt" /> שדות אישיים למשפחה</h3>
      <div className="chip-row">
        {fields.map((f) => (
          <span className="chip" key={f}>
            {f}
            <button aria-label={`הסרת ${f}`} onClick={() => void updateSettings({ customFields: fields.filter((x) => x !== f) })}>✕</button>
          </span>
        ))}
        {fields.length === 0 && <span className="placeholder">אין שדות מותאמים</span>}
      </div>
      <form className="chip-add" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v && !fields.includes(v)) void updateSettings({ customFields: [...fields, v] }); setDraft(''); }}>
        <input value={draft} placeholder="למשל: ארץ מוצא, תפקיד…" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="login-btn">הוסף</button>
      </form>
    </div>
  );
}

/** 7. קמפיינים וגיוס כספים — appSettings.campaigns כמו בישן */
function CampaignsCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const campaigns = (db.__SETTINGS__?.campaigns ?? []) as { key: string; label: string; year?: number; active?: boolean; goal?: number }[];
  const [draft, setDraft] = useState('');

  return (
    <div className="settings-card">
      <h3><i className="fas fa-bullseye" /> קמפיינים וגיוס כספים</h3>
      {campaigns.length === 0 && <p className="placeholder">אין קמפיינים עדיין.</p>}
      <ul className="tpl-list">
        {campaigns.map((c) => (
          <li key={c.key}>
            <div>
              <strong>{c.label}</strong>
              <span className="tpl-text"> · {c.year ?? ''} {c.active === false ? '· כבוי' : '· פעיל'}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="login-btn" style={{ padding: '3px 10px', fontSize: 12 }}
                onClick={() => void updateSettings({ campaigns: campaigns.map((x) => x.key === c.key ? { ...x, active: x.active === false } : x) })}
              >
                {c.active === false ? 'הפעל' : 'כבה'}
              </button>
              <button className="close-btn" aria-label={`מחיקת ${c.label}`} onClick={() => void updateSettings({ campaigns: campaigns.filter((x) => x.key !== c.key) })}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="chip-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          // אותו מבנה כמו addCampaign בישן
          void updateSettings({
            campaigns: [...campaigns, { key: 'camp_' + Date.now(), label: draft.trim(), year: new Date().getFullYear(), active: true, goal: 0 }],
          });
          setDraft('');
        }}
      >
        <input value={draft} placeholder="שם הקמפיין…" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="login-btn">קמפיין חדש</button>
      </form>
    </div>
  );
}

/** 8. ניקוד וסימון אוטומטי — scoringRules (צבעי הסמנים במפה!) */
function ScoringRulesCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const rules = ((db.__SETTINGS__?.scoringRules ?? DEFAULT_SCORING_RULES) as ScoringRules);
  const channels = rules.channels?.length ? rules.channels : DEFAULT_SCORING_RULES.channels;
  const thresholds = rules.thresholds ?? DEFAULT_SCORING_RULES.thresholds;

  const save = (next: ScoringRules) => void updateSettings({ scoringRules: next });

  return (
    <div className="settings-card">
      <h3><i className="fas fa-traffic-light" /> ניקוד וסימון אוטומטי — צבעי המפה</h3>
      <div className="score-grid">
        {channels.map((c) => (
          <div key={c.key} className="score-row" style={{ gap: 6 }}>
            <span>{c.label ?? c.key}</span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number" dir="ltr" defaultValue={c.points} title="נקודות"
                onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ ...rules, channels: channels.map((x) => x.key === c.key ? { ...x, points: v } : x) }); }}
              />
              <small className="tpl-text">נק׳ /</small>
              <input
                type="number" dir="ltr" defaultValue={c.ttlDays} title="ימי תוקף"
                onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ ...rules, channels: channels.map((x) => x.key === c.key ? { ...x, ttlDays: v } : x) }); }}
              />
              <small className="tpl-text">ימים</small>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13 }}>🟢 ירוק מ-</span>
        <input type="number" dir="ltr" defaultValue={thresholds.green} style={{ width: 60, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8, textAlign: 'center' }}
          onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ ...rules, thresholds: { ...thresholds, green: v } }); }} />
        <span style={{ fontSize: 13 }}>🟠 כתום מ-</span>
        <input type="number" dir="ltr" defaultValue={thresholds.orange} style={{ width: 60, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8, textAlign: 'center' }}
          onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) save({ ...rules, thresholds: { ...thresholds, orange: v } }); }} />
        <span className="tpl-text">מתחת — אדום · ללא קשר — אפור</span>
      </div>
    </div>
  );
}

/** 6. ניקוד מעורבות וסוגי פעילות — interactionTypes כמו בישן */
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

function InteractionTypesCard({ db }: { db: Db }) {
  const updateSettings = useCrm((s) => s.updateSettings);
  const saved = (db.__SETTINGS__?.interactionTypes ?? []) as { key: string; label: string; defaultScore: number }[];
  const types = saved.length ? saved : DEFAULT_INTERACTION_TYPES;

  return (
    <div className="settings-card">
      <h3><i className="fas fa-star-half-stroke" /> ניקוד מעורבות וסוגי פעילות</h3>
      <div className="score-grid">
        {types.map((t) => (
          <label key={t.key} className="score-row">
            <span>{t.label}</span>
            <input
              type="number" min={0} max={100} dir="ltr" defaultValue={t.defaultScore}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v !== t.defaultScore) {
                  void updateSettings({ interactionTypes: types.map((x) => x.key === t.key ? { ...x, defaultScore: v } : x) });
                }
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** ניהול סוגי אירועים — customEventTypes כמו בישן */
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
            <button className="close-btn" aria-label={`מחיקת ${t.label}`} onClick={() => void updateSettings({ customEventTypes: types.filter((x) => x.id !== t.id) })}>✕</button>
          </li>
        ))}
      </ul>
      <form className="chip-add" onSubmit={(e) => { e.preventDefault(); if (!label.trim()) return; void updateSettings({ customEventTypes: [...types, { id: 'custom_' + Date.now(), label: label.trim(), emoji, color: '#3b82f6', recurring }] }); setLabel(''); }}>
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


/** סנכרון אנשי קשר Google — People API עם אותם scopes כמו הישן */
function ContactsSyncCard({ db }: { db: Db }) {
  const importFamilies = useCrm((s) => s.importFamilies);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<{ name: string; phone: string; sel: boolean }[] | null>(null);
  const [result, setResult] = useState('');

  const norm = (p: string) => p.replace(/\D/g, '').replace(/^972/, '0');

  const scan = async () => {
    setBusy(true); setResult('');
    try {
      const token = (await browserTokens.getToken()) ?? (await browserTokens.refresh());
      if (!token) { setResult('יש להתחבר ל-Google קודם'); return; }
      const existing = new Set<string>();
      const { buildingKeys, getBuilding, liveApts } = await import('@shlichus/core');
      for (const key of buildingKeys(db)) {
        liveApts(getBuilding(db, key)?.apts).forEach((a) => {
          [a.fatherPhone, a.motherPhone].forEach((p) => { if (p) existing.add(norm(String(p))); });
        });
      }
      let pageToken = '';
      const found: { name: string; phone: string; sel: boolean }[] = [];
      do {
        const url = new URL('https://people.googleapis.com/v1/people/me/connections');
        url.searchParams.set('personFields', 'names,phoneNumbers');
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = (await r.json()) as { connections?: { names?: { displayName?: string }[]; phoneNumbers?: { value?: string }[] }[]; nextPageToken?: string };
        (d.connections ?? []).forEach((c) => {
          const name = c.names?.[0]?.displayName ?? '';
          const phone = c.phoneNumbers?.[0]?.value ?? '';
          if (name && phone && !existing.has(norm(phone))) found.push({ name, phone, sel: false });
        });
        pageToken = d.nextPageToken ?? '';
      } while (pageToken);
      setCandidates(found);
      if (!found.length) setResult('כל אנשי הקשר כבר במערכת ✓');
    } catch {
      setResult('שגיאה בטעינת אנשי קשר — ודא חיבור Google');
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    const sel = (candidates ?? []).filter((c) => c.sel);
    if (!sel.length) return;
    const res = await importFamilies(sel.map((c) => ({ name: c.name, bldg: '', num: '', phone: c.phone, style: '', tags: [] })));
    setResult(`יובאו ${res.imported} אנשי קשר ✓`);
    setCandidates(null);
  };

  return (
    <div className="settings-card">
      <h3><i className="fab fa-google" /> סנכרון אנשי קשר Google</h3>
      {!candidates && (
        <button className="login-btn" disabled={busy} onClick={() => void scan()}>
          {busy ? 'סורק…' : 'סרוק אנשי קשר חדשים'}
        </button>
      )}
      {candidates && candidates.length > 0 && (
        <>
          <p className="tpl-text">{candidates.length} אנשי קשר שאינם במערכת — סמן לייבוא:</p>
          <ul className="tpl-list" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {candidates.map((c, i) => (
              <li key={i} style={{ padding: '6px 12px' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={c.sel} onChange={() => setCandidates((arr) => arr!.map((x, xi) => xi === i ? { ...x, sel: !x.sel } : x))} />
                  <strong>{c.name}</strong>
                  <span className="tpl-text" dir="ltr">{c.phone}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="edit-actions">
            <button className="save-btn" onClick={() => void doImport()}>ייבוא הנבחרים</button>
            <button className="cancel-btn" onClick={() => setCandidates(null)}>ביטול</button>
          </div>
        </>
      )}
      {result && <p className="tpl-text">{result}</p>}
    </div>
  );
}

export function SettingsView({ db }: { db: Db }) {
  return (
    <section>

      {/* סדר וסגנון זהים למודל ההגדרות הישן: סקשנים מתקפלים בעמודה אחת */}
      <div className="settings-col">
        <HomeLocationCard db={db} />
        <details className="settings-sec" open>
          <summary><i className="fas fa-draw-polygon" /> אזור השליחות</summary>
          <div className="sec-body"><TerritoryCard db={db} /></div>
        </details>
        <AppearanceCard db={db} />
        <details className="settings-sec">
          <summary><i className="fas fa-sliders" /> התאמה אישית — תגיות, סגנונות ושדות</summary>
          <div className="sec-body">
            <TagsCard db={db} />
            <StylesCard db={db} />
            <CustomFieldsCard db={db} />
          </div>
        </details>
      </div>

      <div className="settings-card" style={{ marginTop: 14 }}>
        <h3><i className="fas fa-database" /> גיבוי</h3>
        <div className="edit-actions">
          <button className="login-btn" onClick={() => exportBackup(db)}>
            <i className="fas fa-download" /> גיבוי ידני (JSON)
          </button>
          <label className="login-btn" style={{ cursor: 'pointer' }}>
            <i className="fas fa-upload" /> שחזור
            <input
              type="file" accept=".json" style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const imported = JSON.parse(await file.text()) as Db;
                  if (!(await confirmDialog('שחזור מגיבוי', 'לייבא את הגיבוי? הוא ימוזג עם הנתונים הקיימים — שום דבר לא יימחק.'))) return;
                  const merged = mergeDb(db, imported);
                  await saveLocal(merged);
                  window.location.reload();
                } catch {
                  void alertDialog('שחזור', 'הקובץ אינו גיבוי תקין');
                }
              }}
            />
          </label>
        </div>
        <p className="tpl-text">הייבוא ממזג — רשומות חדשות מתווספות, קיימות מתעדכנות לפי החדש מביניהן.</p>
      </div>

      <div style={{ marginTop: 14 }}>
        <InteractionTypesCard db={db} />
      </div>

      <div style={{ marginTop: 14 }}>
        <ScoringRulesCard db={db} />
      </div>

      <div style={{ marginTop: 14 }}>
        <CampaignsCard db={db} />
      </div>

      <div className="settings-card" style={{ marginTop: 14 }}>
        <h3><i className="fas fa-calendar-plus" /> סוגי אירועים מותאמים</h3>
        <EventTypesEditor db={db} />
      </div>

      <div style={{ marginTop: 14 }}>
        <ImportCsv onDone={() => window.location.reload()} />
      </div>
      <div style={{ marginTop: 14 }}>
        <ContactsSyncCard db={db} />
      </div>
    </section>
  );
}
