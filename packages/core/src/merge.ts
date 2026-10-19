/**
 * מיזוג מסדי נתונים — הגרסה המתוקנת של mergeDB מ-drive.js.
 *
 * תיקונים לעומת הישן:
 * 1. מחיקות לא קמות לתחייה — tombstone (deletedAt) מנצח כל גרסה ישנה יותר.
 * 2. info של בניין ממוזג (הישן התעלם משינויי info מהצד השני).
 * 3. __BOARDS__ ו-__SETTINGS__ ממוזגים (הישן דילג עליהם לגמרי).
 * 4. בניינים שקיימים רק מקומית נשמרים (כמו בישן — union).
 */
import type { Apartment, Board, Db, BuildingEntry } from './types.js';
import { allBuildingKeys, getBuilding, resolveBuildingKey } from './types.js';

/** מפתח זהות לדירה: id יציב אם קיים, אחרת name_num (תאימות לישן) */
export function aptIdentity(a: Apartment): string {
  if (a.id) return `id:${a.id}`;
  return `legacy:${a.name ?? ''}_${a.num ?? ''}`;
}

/** הדירה "החיה" יותר — לפי updatedAt/deletedAt המאוחר מביניהם */
function newerApt(a: Apartment, b: Apartment): Apartment {
  const at = Math.max(a.updatedAt ?? 0, a.deletedAt ?? 0);
  const bt = Math.max(b.updatedAt ?? 0, b.deletedAt ?? 0);
  return bt > at ? b : a;
}

/** השוואה יציבה (סדר מפתחות לא משנה) */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * מיזוג רשימה מול הגרסה המשותפת האחרונה (base): פריט שנמחק באחד הצדדים — נמחק;
 * פריט שנוסף באחד הצדדים — נשמר. פריט שנערך = נמחק הישן + נוסף החדש.
 */
function mergeList(local: unknown[], remote: unknown[], base: unknown[]): unknown[] {
  const inBase = new Set(base.map(stable));
  const inLocal = new Set(local.map(stable));
  const inRemote = new Set(remote.map(stable));
  const out: unknown[] = [];
  const seen = new Set<string>();
  const keep = (x: unknown) => { const k = stable(x); if (!seen.has(k)) { seen.add(k); out.push(x); } };
  for (const x of local) { const k = stable(x); if (inRemote.has(k) || !inBase.has(k)) keep(x); }
  for (const x of remote) { const k = stable(x); if (!inLocal.has(k) && !inBase.has(k)) keep(x); }
  return out;
}

/**
 * מיזוג תלת-כיווני של רשומה (משפחה / הגדרות): לכל שדה — אם רק צד אחד שינה אותו מאז
 * הסנכרון האחרון, השינוי שלו נשמר; אם שניהם שינו רשימה — מאחדים; אם שניהם שינו ערך — המאוחר.
 */
function mergeRecord<T extends Record<string, unknown>>(local: T, remote: T, base: T, remoteIsNewer: boolean): T {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const lv = local[k], rv = remote[k], bv = base[k];
    if (same(lv, rv)) out[k] = lv;
    else if (same(lv, bv)) out[k] = rv;
    else if (same(rv, bv)) out[k] = lv;
    else if (Array.isArray(lv) || Array.isArray(rv)) out[k] = mergeList((lv ?? []) as unknown[], (rv ?? []) as unknown[], Array.isArray(bv) ? bv : []);
    else out[k] = remoteIsNewer ? rv : lv;
    if (out[k] === undefined) delete out[k];
  }
  return out as T;
}

function mergeApts(local: Apartment[], remote: Apartment[], base: Apartment[] = []): Apartment[] {
  const baseMap = new Map(base.map((a) => [aptIdentity(a), a]));
  const map = new Map<string, Apartment>();
  for (const a of local) map.set(aptIdentity(a), a);
  for (const r of remote) {
    const key = aptIdentity(r);
    const existing = map.get(key);
    const b = baseMap.get(key);
    if (!existing) map.set(key, r);
    // מחיקה, או אין גרסה משותפת — כמו קודם: הגרסה המאוחרת
    else if (!b || existing.deletedAt || r.deletedAt) map.set(key, newerApt(existing, r));
    else {
      const rNewer = (r.updatedAt ?? 0) > (existing.updatedAt ?? 0);
      const m = mergeRecord(existing as Record<string, unknown>, r as Record<string, unknown>, b as Record<string, unknown>, rNewer) as Apartment;
      m.updatedAt = Math.max(existing.updatedAt ?? 0, r.updatedAt ?? 0) || undefined;
      if (m.updatedAt === undefined) delete m.updatedAt;
      map.set(key, m);
    }
  }
  return [...map.values()];
}

function mergeInfo(local: BuildingEntry, remote: BuildingEntry): BuildingEntry['info'] {
  const lt = local.info?.updatedAt ?? 0;
  const rt = remote.info?.updatedAt ?? 0;
  // בלי חותמות זמן — עדיפות למקומי (התנהגות הישן), אחרת LWW
  return rt > lt ? { ...local.info, ...remote.info } : { ...remote.info, ...local.info };
}

function mergeBoards(local: Board[] | undefined, remote: Board[] | undefined): Board[] | undefined {
  if (!remote) return local;
  if (!local) return remote;
  const map = new Map<string, Board>();
  for (const b of local) map.set(b.id, b);
  for (const r of remote) {
    const existing = map.get(r.id);
    if (!existing) map.set(r.id, r);
    else if ((r.updatedAt ?? 0) > (existing.updatedAt ?? 0)) map.set(r.id, r);
  }
  return [...map.values()];
}

/**
 * @param base הגרסה האחרונה שסונכרנה עם הענן (אם ידועה) — מאפשרת לשמור שינויים של שני
 *             המכשירים באותה משפחה במקום לבחור אחד מהם.
 */
export function mergeDb(local: Db, remote: Db, base?: Db | null): Db {
  if (!remote) return local;
  if (!local) return remote;

  const result: Db = structuredClone(local);

  for (const key of allBuildingKeys(remote)) {
    const remoteEntry = getBuilding(remote, key)!;
    const localEntry = getBuilding(result, key);
    if (!localEntry) {
      result[key] = structuredClone(remoteEntry);
      continue;
    }
    localEntry.apts = mergeApts(localEntry.apts ?? [], remoteEntry.apts ?? [], base ? getBuilding(base, key)?.apts ?? [] : []);
    localEntry.info = mergeInfo(localEntry, remoteEntry);
  }

  redirectMoved(result);

  result.__BOARDS__ = mergeBoards(local.__BOARDS__, remote.__BOARDS__);

  // הגדרות: LWW לפי updatedAt של ההגדרות, ואם אין — לפי meta.lastModified של הצד
  const ls = local.__SETTINGS__;
  const rs = remote.__SETTINGS__;
  if (!ls) result.__SETTINGS__ = rs;
  else if (rs) {
    const lt = ls.updatedAt ?? local.meta?.lastModified ?? 0;
    const rt = rs.updatedAt ?? remote.meta?.lastModified ?? 0;
    const bs = base?.__SETTINGS__;
    result.__SETTINGS__ = bs
      ? { ...mergeRecord(ls as Record<string, unknown>, rs as Record<string, unknown>, bs as Record<string, unknown>, rt > lt), updatedAt: Math.max(lt, rt) }
      : rt > lt ? rs : ls;
  }

  result.meta = mergeMeta(local.meta, remote.meta);
  return result;
}

/**
 * בניין שהועבר (מצבה עם movedTo) לא מחזיק דירות: דירות שהגיעו אליו מעותק ישן
 * או ממכשיר אחר עוברות לכתובת החדשה, בלי כפילויות.
 */
function redirectMoved(db: Db): void {
  for (const key of allBuildingKeys(db)) {
    const entry = getBuilding(db, key)!;
    if (!entry.info?.movedTo) continue;
    if (entry.apts?.length) {
      const target = getBuilding(db, resolveBuildingKey(db, key));
      if (target && target !== entry) target.apts = mergeApts(target.apts ?? [], entry.apts.filter((a) => !a.deletedAt));
    }
    entry.apts = [];
  }
}

/**
 * מיזוג meta — חשוב במיוחד כי אפליקציית השטח כותבת לכאן דרך המערכת הישנה:
 * meta.events (אירועים) ו-meta.generalTasks (משימות כלליות).
 */
function mergeMeta(local: Db['meta'], remote: Db['meta']): NonNullable<Db['meta']> {
  const lt = local?.lastModified ?? 0;
  const rt = remote?.lastModified ?? 0;
  // בסיס: הצד המאוחר; ואז מיזוג פרטני לשדות המצטברים
  const base = { ...(rt > lt ? local : remote), ...(rt > lt ? remote : local) };

  // משימות כלליות: איחוד לפי טקסט+תאריך; "בוצע" מנצח (סומן באחד המכשירים — נשאר מסומן)
  const lTasks = (local?.generalTasks ?? []) as { text?: string; date?: string; done?: boolean }[];
  const rTasks = (remote?.generalTasks ?? []) as { text?: string; date?: string; done?: boolean }[];
  if (lTasks.length || rTasks.length) {
    const map = new Map<string, { text?: string; date?: string; done?: boolean }>();
    for (const t of [...lTasks, ...rTasks]) {
      const key = `${t.text ?? ''}|${t.date ?? ''}`;
      const existing = map.get(key);
      map.set(key, existing ? { ...existing, ...t, done: !!(existing.done || t.done) } : t);
    }
    base.generalTasks = [...map.values()];
  }

  // אירועים: איחוד לפי id. שדות האירוע (שם, תאריך, ביטול) — מהגרסה שעודכנה אחרונה (updatedAt);
  // נרשמים — איחוד לפי שם (אף נרשם לא הולך לאיבוד); נוכחות — מהגרסה העדכנית אם שתיהן נערכו כאן,
  // אחרת איחוד (אפליקציית השטח מוסיפה נוכחות בלי חותמת זמן)
  type Ev = { id?: string; updatedAt?: number; registrants?: { name?: string }[]; attendance?: string[] };
  const lEvents = (local?.events ?? []) as Ev[];
  const rEvents = (remote?.events ?? []) as Ev[];
  if (lEvents.length || rEvents.length) {
    const map = new Map<string, Ev>();
    for (const ev of [...lEvents, ...rEvents]) {
      const key = ev.id ?? JSON.stringify(ev);
      const existing = map.get(key);
      if (!existing) { map.set(key, ev); continue; }
      const size = (e: Ev) => (e.registrants?.length ?? 0) + (e.attendance?.length ?? 0);
      const newer = (ev.updatedAt ?? 0) !== (existing.updatedAt ?? 0)
        ? ((ev.updatedAt ?? 0) > (existing.updatedAt ?? 0) ? ev : existing)
        : ev.updatedAt ? existing // אותה חותמת בדיוק — העותק המקומי (הראשון) נשאר
        : size(ev) >= size(existing) ? ev : existing;
      const regs = new Map<string, { name?: string }>();
      for (const r of [...(existing.registrants ?? []), ...(ev.registrants ?? [])]) regs.set(String(r.name ?? JSON.stringify(r)), r);
      const bothStamped = !!ev.updatedAt && !!existing.updatedAt;
      const attendance = bothStamped ? (newer.attendance ?? []) : [...new Set([...(existing.attendance ?? []), ...(ev.attendance ?? [])])];
      map.set(key, { ...newer, registrants: [...regs.values()], attendance });
    }
    base.events = [...map.values()];
  }

  base.lastModified = Math.max(lt, rt);
  return base as NonNullable<Db['meta']>;
}

/**
 * מחיקה רכה של דירה — במקום splice.
 * הדירה נשארת עם deletedAt כדי שהמחיקה תשרוד סנכרון מכל מכשיר.
 */
export function softDeleteApt(apt: Apartment): void {
  const now = Date.now();
  apt.deletedAt = now;
  apt.updatedAt = now;
}

/** הדירות החיות בלבד — לכל שכבת UI */
export function liveApts(apts: Apartment[] | undefined): Apartment[] {
  return (apts ?? []).filter((a) => !a.deletedAt);
}
