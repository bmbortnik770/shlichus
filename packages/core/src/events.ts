/**
 * אירועי קהילה (meta.events) — אותו מבנה כמו אפליקציית השטח והמערכת הקיימת:
 * { id, name, type, date, time, location, registrants: [{name, phone, famRef}], attendance: [names] }
 */
import type { Db } from './types.js';
import { parseLooseDate } from './dates.js';

export interface Registrant { name: string; phone?: string; famRef?: string | null }
export interface CommunityEvent {
  id: string;
  name: string;
  type?: string;
  date?: string;
  time?: string;
  location?: string;
  notes?: string;
  registrants: Registrant[];
  attendance: string[];
  cancelled?: boolean;
  createdAt?: string;
  updatedAt?: number;
}

export function listEvents(db: Db, includeCancelled = false): CommunityEvent[] {
  return ((db.meta?.events ?? []) as Record<string, unknown>[])
    .map((e) => ({ ...e, id: String(e.id ?? ''), name: String(e.name ?? e.title ?? 'אירוע'), registrants: (e.registrants ?? []) as Registrant[], attendance: (e.attendance ?? []) as string[] }) as CommunityEvent)
    .filter((e) => includeCancelled || !e.cancelled)
    .sort((a, b) => (parseLooseDate(b.date)?.getTime() ?? 0) - (parseLooseDate(a.date)?.getTime() ?? 0));
}

function writeEvents(db: Db, fn: (list: CommunityEvent[]) => CommunityEvent[]): void {
  const list = (db.meta?.events ?? []) as CommunityEvent[];
  db.meta = { ...(db.meta ?? { lastModified: 0 }), events: fn([...list]) };
}

export function createEvent(db: Db, ev: Pick<CommunityEvent, 'name' | 'date' | 'time' | 'location' | 'type' | 'notes'>): string {
  const id = `evt_${Date.now()}`;
  writeEvents(db, (l) => [...l, { ...ev, id, registrants: [], attendance: [], createdAt: new Date().toISOString(), updatedAt: Date.now() }]);
  return id;
}

export function updateEvent(db: Db, id: string, patch: Partial<CommunityEvent>): void {
  writeEvents(db, (l) => l.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e)));
}

export function addRegistrant(db: Db, id: string, r: Registrant): void {
  writeEvents(db, (l) => l.map((e) => (e.id === id && !(e.registrants ?? []).some((x) => x.name === r.name)
    ? { ...e, registrants: [...(e.registrants ?? []), { name: r.name, phone: r.phone ?? '', famRef: r.famRef ?? null }], updatedAt: Date.now() } : e)));
}

export function toggleAttendance(db: Db, id: string, name: string): void {
  writeEvents(db, (l) => l.map((e) => {
    if (e.id !== id) return e;
    const att = e.attendance ?? [];
    return { ...e, attendance: att.includes(name) ? att.filter((n) => n !== name) : [...att, name], updatedAt: Date.now() };
  }));
}

/** סוגי תאריכים למשפחה (אבני דרך) — מובנים + מותאמים (__SETTINGS__.customEventTypes כמו בישן) */
export interface EventType { id: string; label: string; emoji?: string; color?: string; recurring: boolean; custom?: boolean }
export const BUILTIN_EVENT_TYPES: EventType[] = [
  { id: 'birthday', label: 'יום הולדת', emoji: '🎂', recurring: true },
  { id: 'yahrzeit', label: 'יארצייט', emoji: '🕯️', recurring: true },
  { id: 'anniversary', label: 'יום נישואין', emoji: '💍', recurring: true },
  { id: 'barmitzva', label: 'בר/בת מצווה', emoji: '📜', recurring: false },
  { id: 'other', label: 'אחר', emoji: '📅', recurring: true },
];
export function getEventTypes(db: Db): EventType[] {
  const custom = ((db.__SETTINGS__?.customEventTypes ?? []) as EventType[]).filter((t) => t && t.id && t.label).map((t) => ({ ...t, custom: true }));
  return [...BUILTIN_EVENT_TYPES, ...custom];
}
export function addEventType(db: Db, t: { label: string; emoji?: string; color?: string; recurring: boolean }): string {
  const id = `custom_${Date.now()}`;
  const list = (db.__SETTINGS__?.customEventTypes ?? []) as EventType[];
  db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), customEventTypes: [...list, { id, label: t.label, emoji: t.emoji || '📅', color: t.color || '#64748b', recurring: t.recurring }], updatedAt: Date.now() };
  return id;
}
export function removeEventType(db: Db, id: string): void {
  const list = (db.__SETTINGS__?.customEventTypes ?? []) as EventType[];
  db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), customEventTypes: list.filter((t) => t.id !== id), updatedAt: Date.now() };
}

/** מדדי אירועי הקהילה: קרובים, נרשמים, שיעור הגעה באירועים שעברו */
export function eventStats(db: Db, now = new Date()): { upcoming: number; past: number; registrants: number; attended: number; attendRate: number | null } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let upcoming = 0, past = 0, regs = 0, att = 0, pastRegs = 0;
  for (const e of listEvents(db)) {
    const t = parseLooseDate(e.date)?.getTime();
    regs += e.registrants.length;
    if (t !== undefined && t < today) { past++; pastRegs += e.registrants.length; att += e.attendance.length; } else upcoming++;
  }
  return { upcoming, past, registrants: regs, attended: att, attendRate: pastRegs ? Math.round((att / pastRegs) * 100) : null };
}
