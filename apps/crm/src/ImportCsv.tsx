import { useState } from 'react';
import { useCrm } from './store';

/** פירוק CSV בסיסי עם תמיכה בשדות מצוטטים */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const FIELDS = [
  { key: 'name', label: 'שם משפחה' },
  { key: 'bldg', label: 'כתובת/רחוב' },
  { key: 'num', label: 'מס׳ דירה' },
  { key: 'phone', label: 'טלפון' },
  { key: 'style', label: 'סגנון' },
  { key: 'tags', label: 'תגיות (מופרדות |)' },
] as const;

export function ImportCsv({ onDone }: { onDone: () => void }) {
  const importFamilies = useCrm((s) => s.importFamilies);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = rows[0] ?? [];

  const guessMapping = (hdrs: string[]) => {
    const m: Record<string, number> = {};
    hdrs.forEach((h, i) => {
      if (/משפחה|שם/.test(h) && m.name === undefined) m.name = i;
      if (/כתובת|רחוב/.test(h)) m.bldg = i;
      if (/דירה|מספר/.test(h) && m.num === undefined) m.num = i;
      if (/טלפון|נייד/.test(h) && m.phone === undefined) m.phone = i;
      if (/סגנון|סטטוס/.test(h)) m.style = i;
      if (/תגי/.test(h)) m.tags = i;
    });
    return m;
  };

  const doImport = async () => {
    if (mapping.name === undefined) { window.alert('חובה למפות את עמודת שם המשפחה'); return; }
    setBusy(true);
    const data = rows.slice(1).map((r) => ({
      name: r[mapping.name!] ?? '',
      bldg: mapping.bldg !== undefined ? (r[mapping.bldg] ?? '') : '',
      num: mapping.num !== undefined ? (r[mapping.num] ?? '') : '',
      phone: mapping.phone !== undefined ? (r[mapping.phone] ?? '') : '',
      style: mapping.style !== undefined ? (r[mapping.style] ?? '') : '',
      tags: mapping.tags !== undefined ? (r[mapping.tags] ?? '').split('|').map((t) => t.trim()).filter(Boolean) : [],
    })).filter((r) => r.name.trim());
    const res = await importFamilies(data);
    setResult(`יובאו ${res.imported} משפחות חדשות · ${res.skipped} דולגו (קיימות)`);
    setBusy(false);
  };

  return (
    <div className="settings-card">
      <h3>ייבוא משפחות מ-CSV</h3>
      {rows.length === 0 && (
        <div className="chip-add">
          <input
            placeholder="או הדבק קישור Google Sheets…" dir="ltr" id="sheetUrlInput"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const url = (e.target as HTMLInputElement).value.trim();
              const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
              if (!m) { window.alert('קישור לא תקין'); return; }
              void (async () => {
                try {
                  const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`);
                  if (!r.ok) throw new Error();
                  const parsed = parseCsv(await r.text());
                  if (parsed.length < 2) { window.alert('הגיליון ריק'); return; }
                  setRows(parsed);
                  setMapping(guessMapping(parsed[0]!));
                } catch {
                  window.alert('לא ניתן לקרוא את הגיליון — ודא שהוא משותף כ"כל מי שיש לו קישור"');
                }
              })();
            }}
          />
        </div>
      )}
      {rows.length === 0 && (
        <label className="login-btn" style={{ cursor: 'pointer', textAlign: 'center' }}>
          <i className="fas fa-file-csv" /> בחירת קובץ CSV
          <input
            type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const parsed = parseCsv(await f.text());
              if (parsed.length < 2) { window.alert('הקובץ ריק או ללא שורות נתונים'); return; }
              setRows(parsed);
              setMapping(guessMapping(parsed[0]!));
            }}
          />
        </label>
      )}
      {rows.length > 0 && !result && (
        <>
          <p className="tpl-text">{rows.length - 1} שורות בקובץ. מיפוי עמודות (זוהה אוטומטית — אפשר לתקן):</p>
          {FIELDS.map((f) => (
            <label className="edit-field" key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <span style={{ minWidth: 130 }}>{f.label}</span>
              <select
                className="board-select"
                value={mapping[f.key] ?? -1}
                onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
              >
                <option value={-1}>— לא בקובץ —</option>
                {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select>
            </label>
          ))}
          <div className="edit-actions">
            <button className="save-btn" disabled={busy} onClick={() => void doImport()}>
              {busy ? 'מייבא…' : `ייבוא ${rows.length - 1} שורות`}
            </button>
            <button className="cancel-btn" onClick={() => { setRows([]); setResult(null); }}>ביטול</button>
          </div>
        </>
      )}
      {result && (
        <>
          <p className="comm-preview">✅ {result}</p>
          <button className="login-btn" onClick={onDone}>לרשימת המשפחות</button>
        </>
      )}
    </div>
  );
}
