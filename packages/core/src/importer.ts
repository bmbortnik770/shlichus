/**
 * ייבוא משפחות מקובץ (CSV מאקסל/גוגל שיטס) ומאנשי קשר — עם זיהוי עמודות ובלי כפילויות.
 */
import type { Db } from './types.js';
import { NO_ADDRESS_KEY, getBuilding } from './types.js';
import { addFamily, familyPhones, listFamilies } from './families.js';

/** פירוק CSV עם שדות מצוטטים, BOM, ושורות Windows */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') inQ = false; else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; }
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

export const IMPORT_FIELDS = [
  { key: 'name', label: 'שם משפחה' }, { key: 'father', label: 'שם האב' }, { key: 'mother', label: 'שם האם' },
  { key: 'bldg', label: 'כתובת (רחוב ומספר)' }, { key: 'num', label: 'דירה' }, { key: 'phone', label: 'טלפון' },
  { key: 'phone2', label: 'טלפון נוסף' }, { key: 'email', label: 'מייל' }, { key: 'style', label: 'סגנון' },
  { key: 'tags', label: 'תגיות' }, { key: 'notes', label: 'הערות' },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];
export type Mapping = Partial<Record<ImportField, number>>;

/** ניחוש עמודות לפי הכותרות */
export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const rules: [ImportField, RegExp][] = [
    ['father', /אב|בעל/], ['mother', /אם|אישה|אשה/], ['name', /משפחה|^שם$|שם מלא/], ['bldg', /כתובת|רחוב/],
    ['num', /דירה/], ['email', /מייל|אימייל|email/i], ['phone2', /טלפון 2|טלפון נוסף|נייד 2/], ['phone', /טלפון|נייד|פלאפון|phone/i],
    ['style', /סגנון/], ['tags', /תגי/], ['notes', /הערות|הערה/],
  ];
  headers.forEach((h, i) => {
    const t = h.trim();
    for (const [k, re] of rules) if (m[k] === undefined && re.test(t)) { m[k] = i; break; }
  });
  return m;
}

export interface ImportResult { imported: number; skipped: number; noAddress: number }

/** ייבוא שורות לפי מיפוי. כפילות = אותו טלפון, או אותו שם באותה כתובת ודירה */
export function importRows(db: Db, rows: string[][], mapping: Mapping, opts: { hasHeader?: boolean } = {}): ImportResult {
  const body = opts.hasHeader === false ? rows : rows.slice(1);
  const get = (r: string[], k: ImportField) => (mapping[k] !== undefined ? String(r[mapping[k]!] ?? '').trim() : '');
  const phones = new Set(listFamilies(db).flatMap((f) => familyPhones(f.apt)));
  const names = new Set(listFamilies(db).map((f) => `${f.bldg}|${f.apt.name ?? ''}|${f.apt.num ?? ''}`));
  const res: ImportResult = { imported: 0, skipped: 0, noAddress: 0 };
  for (const r of body) {
    const name = get(r, 'name'), father = get(r, 'father'), mother = get(r, 'mother');
    if (!name && !father && !mother) { res.skipped++; continue; }
    const bldg = get(r, 'bldg') || NO_ADDRESS_KEY;
    const num = get(r, 'num');
    const phone = get(r, 'phone'), phone2 = get(r, 'phone2');
    const clean = [phone, phone2].map((p) => p.replace(/[^\d+]/g, '')).filter((p) => p.length >= 9);
    if (clean.some((p) => phones.has(p)) || names.has(`${bldg}|${name}|${num}`)) { res.skipped++; continue; }
    const tags = get(r, 'tags').split(/[|,;]/).map((t) => t.trim()).filter(Boolean);
    addFamily(db, bldg, {
      name, father, mother, num, fatherPhone: phone, motherPhone: phone2, fatherEmail: get(r, 'email'),
      style: get(r, 'style'), tags, notes: get(r, 'notes'),
    });
    clean.forEach((p) => phones.add(p));
    names.add(`${bldg}|${name}|${num}`);
    res.imported++;
    if (bldg === NO_ADDRESS_KEY) res.noAddress++;
  }
  // תגיות/סגנונות חדשים מהקובץ נכנסים לרשימות
  const s = db.__SETTINGS__ ?? {};
  const allTags = new Set((s.tags ?? []) as string[]);
  const allStyles = new Set((s.styles ?? []) as string[]);
  for (const f of listFamilies(db)) { (f.apt.tags ?? []).forEach((t) => allTags.add(t)); if (f.apt.style) allStyles.add(f.apt.style); }
  db.__SETTINGS__ = { ...s, tags: [...allTags], styles: [...allStyles] };
  return res;
}
