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
