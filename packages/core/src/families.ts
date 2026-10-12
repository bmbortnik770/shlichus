/**
 * פעולות על משפחות — משותפות לכל הממשקים, בטוחות לסנכרון.
 * מבנה הנתונים זהה למערכת הקיימת (apts בתוך בניין לפי כתובת).
 */
import type { Apartment, Db } from './types.js';
import { NO_ADDRESS_KEY, buildingKeys, getBuilding } from './types.js';
import { softDeleteApt } from './merge.js';

export interface FamilyRef { bldg: string; idx: number }
export interface FamilyRow extends FamilyRef { apt: Apartment }

const newId = () => `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function ensureEntry(db: Db, key: string) {
  const existing = getBuilding(db, key);
  if (existing && !existing.info.movedTo && !existing.info.deletedAt) return existing;
  db[key] = { info: { code: '', rep: '', notes: '', coords: null, updatedAt: Date.now() }, apts: existing?.apts ?? [] };
  return getBuilding(db, key)!;
}

/** כל המשפחות החיות, כולל "ללא כתובת" */
export function listFamilies(db: Db): FamilyRow[] {
  const out: FamilyRow[] = [];
  const keys = [...buildingKeys(db)];
  if (getBuilding(db, NO_ADDRESS_KEY) && !keys.includes(NO_ADDRESS_KEY)) keys.push(NO_ADDRESS_KEY);
  for (const bldg of keys) {
    getBuilding(db, bldg)!.apts.forEach((apt, idx) => { if (!apt.deletedAt) out.push({ bldg, idx, apt }); });
  }
  return out;
}

/** משפחה חדשה — אותו מבנה כמו addApt במערכת הקיימת */
export function addFamily(db: Db, bldg: string, patch: Partial<Apartment> = {}): FamilyRef {
  const key = bldg.trim() || NO_ADDRESS_KEY;
  const entry = ensureEntry(db, key);
  const styles = (db.__SETTINGS__?.styles ?? []) as string[];
  entry.apts.push({
    id: newId(), name: '', num: '', style: styles[0] ?? '',
    tags: [], boards: {}, childrenList: [], interactions: [], donations: [], tasks: [],
    customFields: {}, ...patch, updatedAt: Date.now(),
  });
  return { bldg: key, idx: entry.apts.length - 1 };
}

export function updateFamily(db: Db, ref: FamilyRef, patch: Partial<Apartment>): void {
  const entry = getBuilding(db, ref.bldg);
  const apt = entry?.apts[ref.idx];
  if (!entry || !apt) return;
  entry.apts[ref.idx] = { ...apt, ...patch, updatedAt: Date.now() };
}

export function deleteFamily(db: Db, ref: FamilyRef): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (apt) softDeleteApt(apt);
}

/**
 * העברת משפחה לכתובת אחרת (למשל שיבוץ משפחה "ללא כתובת").
 * במקור נשארת מצבה, כך שעותק ישן בענן לא יחזיר את המשפחה למקום הקודם.
 * אותו מזהה נשמר — אם המשפחה חוזרת לכתובת שהייתה בה, המצבה שם מוחלפת.
 */
export function moveFamily(db: Db, ref: FamilyRef, toKey: string, num?: string): FamilyRef | null {
  const target = toKey.trim() || NO_ADDRESS_KEY;
  const src = getBuilding(db, ref.bldg);
  const apt = src?.apts[ref.idx];
  if (!src || !apt) return null;
  if (target === ref.bldg) {
    if (num !== undefined) updateFamily(db, ref, { num });
    return ref;
  }
  const now = Date.now();
  const id = apt.id ?? newId();
  const moved: Apartment = { ...apt, id, num: num ?? apt.num, updatedAt: now };
  delete moved.deletedAt;
  src.apts[ref.idx] = { ...apt, id, deletedAt: now, updatedAt: now };
  const entry = ensureEntry(db, target);
  const at = entry.apts.findIndex((a) => a.id === id);
  if (at >= 0) { entry.apts[at] = moved; return { bldg: target, idx: at }; }
  entry.apts.push(moved);
  return { bldg: target, idx: entry.apts.length - 1 };
}

/** פיצול כרטיס — כרטיס נפרד לבן משפחה, עם קישור דו-כיווני (כמו confirmSplitMember בישן) */
export function splitFamily(db: Db, ref: FamilyRef, memberName: string): FamilyRef | null {
  const orig = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!orig) return null;
  const splitDate = new Date().toISOString().slice(0, 10);
  const target = ensureEntry(db, NO_ADDRESS_KEY);
  target.apts.push({
    id: newId(), name: memberName, style: orig.style ?? '', tags: [...(orig.tags ?? [])],
    childrenList: [], boards: {}, customData: {}, customFields: {}, milestones: [],
    interactions: [{ date: splitDate, type: 'פיצול כרטיס', text: `נפצל מכרטיס משפחת ${orig.name ?? ''}`, member: 'family' }],
    donations: [], tasks: [], splitDate, linkedFrom: `${ref.bldg}|${ref.idx}`, updatedAt: Date.now(),
  });
  const newIdx = target.apts.length - 1;
  orig.splits = [...((orig.splits ?? []) as unknown[]), { memberName, splitDate, linkedTo: `${NO_ADDRESS_KEY}|${newIdx}` }];
  orig.updatedAt = Date.now();
  return { bldg: NO_ADDRESS_KEY, idx: newIdx };
}

/** כתובת להצגה: "רחוב מספר, דירה X" או "ללא כתובת" */
export function familyAddress(bldg: string, apt: Apartment): string {
  if (bldg === NO_ADDRESS_KEY) return 'ללא כתובת';
  return apt.num ? `${bldg}, דירה ${apt.num}` : bldg;
}

/** כל הטלפונים של משפחה, מנוקים, בלי כפילויות */
export function familyPhones(apt: Apartment): string[] {
  const raw = [apt.fatherPhone, apt.motherPhone, apt.phones].flatMap((p) => String(p ?? '').split(/[,;/]| · /));
  return [...new Set(raw.map((p) => p.replace(/[^\d+]/g, '')).filter((p) => p.length >= 9))];
}

/** קישור וואטסאפ בפורמט בינלאומי */
export function waLink(phone: string, text?: string): string {
  const intl = phone.replace(/[^\d]/g, '').replace(/^0/, '972');
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
