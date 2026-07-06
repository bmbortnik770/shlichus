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
import { buildingKeys, getBuilding } from './types.js';

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

function mergeApts(local: Apartment[], remote: Apartment[]): Apartment[] {
  const map = new Map<string, Apartment>();
  for (const a of local) map.set(aptIdentity(a), a);
  for (const r of remote) {
    const key = aptIdentity(r);
    const existing = map.get(key);
    map.set(key, existing ? newerApt(existing, r) : r);
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

export function mergeDb(local: Db, remote: Db): Db {
  if (!remote) return local;
  if (!local) return remote;

  const result: Db = structuredClone(local);

  for (const key of buildingKeys(remote)) {
    const remoteEntry = getBuilding(remote, key)!;
    const localEntry = getBuilding(result, key);
    if (!localEntry) {
      result[key] = structuredClone(remoteEntry);
      continue;
    }
    localEntry.apts = mergeApts(localEntry.apts ?? [], remoteEntry.apts ?? []);
    localEntry.info = mergeInfo(localEntry, remoteEntry);
  }

  result.__BOARDS__ = mergeBoards(local.__BOARDS__, remote.__BOARDS__);

  // הגדרות: LWW לפי updatedAt של ההגדרות, ואם אין — לפי meta.lastModified של הצד
  const ls = local.__SETTINGS__;
  const rs = remote.__SETTINGS__;
  if (!ls) result.__SETTINGS__ = rs;
  else if (rs) {
    const lt = ls.updatedAt ?? local.meta?.lastModified ?? 0;
    const rt = rs.updatedAt ?? remote.meta?.lastModified ?? 0;
    result.__SETTINGS__ = rt > lt ? rs : ls;
  }

  result.meta = mergeMeta(local.meta, remote.meta);
  return result;
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

  // אירועים: איחוד לפי id; לכפילות — הרשומה עם יותר נרשמים/נוכחות (הצטברות משטח)
  type Ev = { id?: string; registrants?: unknown[]; attendance?: unknown[] };
  const lEvents = (local?.events ?? []) as Ev[];
  const rEvents = (remote?.events ?? []) as Ev[];
  if (lEvents.length || rEvents.length) {
    const map = new Map<string, Ev>();
    for (const ev of [...lEvents, ...rEvents]) {
      const key = ev.id ?? JSON.stringify(ev);
      const existing = map.get(key);
      if (!existing) { map.set(key, ev); continue; }
      const size = (e: Ev) => (e.registrants?.length ?? 0) + (e.attendance?.length ?? 0);
      map.set(key, size(ev) >= size(existing) ? ev : existing);
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
