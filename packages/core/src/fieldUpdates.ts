/**
 * קליטת עדכונים מאפליקציית השטח — אותה לוגיקה כמו applyOutboxEvent/mergeOutboxUpdates במערכת הקיימת,
 * עם שני תיקונים: מחיקת משפחה = מצבה (ולא splice שהיה חוזר בסנכרון), ומזהה לכל משפחה חדשה.
 * מזהי אירועים שיושמו נשמרים ב-__SETTINGS__.appliedEventIds (30 יום) — משותף עם המערכת הקיימת,
 * כך ששתי המערכות לא מחילות את אותו עדכון פעמיים.
 */
import type { Apartment, Db, Task } from './types.js';
import { getBuilding } from './types.js';
import { softDeleteApt } from './merge.js';
import type { DriveSync } from './driveSync.js';

export interface FieldEvent {
  id?: string;
  type: string;
  bldg?: string;
  aptName?: string;
  aptNum?: string | number;
  aptIdx?: number;
  taskIdx?: number;
  logIdx?: number;
  eventId?: string;
  eventIdx?: number;
  tag?: string;
  field?: string;
  value?: string;
  attribution?: string;
  text?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

/** כמו escapeHTML בישן — המערכת הקיימת מציגה הערות ב-innerHTML */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]!);

export const fieldEventId = (ev: FieldEvent) => ev.id || `${ev.type}_${ev.bldg}_${ev.aptName}_${ev.timestamp}`;

type Ev = { id?: string; registrants?: { name?: string; phone?: string; famRef?: unknown }[]; attendance?: string[]; updatedAt?: number };

/** מחיל אירוע אחד; מחזיר true אם נמצא היעד והעדכון בוצע */
export function applyFieldEvent(db: Db, ev: FieldEvent): boolean {
  if (!ev?.type) return false;
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const meta = () => (db.meta ??= { lastModified: 0 });

  if (ev.type === 'event_create') {
    meta().events = [...((meta().events ?? []) as Ev[]), { ...p, id: String(p.id ?? ev.timestamp ?? Date.now()), registrants: [], attendance: [] }];
    return true;
  }
  if (ev.type === 'event_add_registrant' || ev.type === 'event_attendance') {
    const list = (meta().events ?? []) as Ev[];
    const e = list.find((x) => x.id === ev.eventId) ?? (typeof ev.eventIdx === 'number' ? list[ev.eventIdx] : undefined);
    if (!e) return false;
    const name = String(p.regName ?? '');
    if (ev.type === 'event_add_registrant') {
      e.registrants ??= [];
      if (name && !e.registrants.some((r) => r.name === name)) e.registrants.push({ name, phone: String(p.regPhone ?? ''), famRef: p.famRef ?? null });
      return true;
    }
    if (!name) return false;
    const att = e.attendance ?? [];
    e.attendance = p.present ? (att.includes(name) ? att : [...att, name]) : att.filter((n) => n !== name);
    return true;
  }
  if (ev.type === 'add_general_task') {
    meta().generalTasks = [...((meta().generalTasks ?? []) as unknown[]), { text: String(p.text ?? ''), date: String(p.date ?? ''), done: false }];
    return true;
  }

  const ts = ev.timestamp || new Date().toISOString();
  const dateHe = new Date(ts).toLocaleDateString('he-IL');

  if (ev.type === 'building_visit_log') {
    const b = ev.bldg ? getBuilding(db, ev.bldg) : undefined;
    if (!b) return false;
    for (const apt of b.apts) {
      if (apt.deletedAt) continue;
      apt.interactions = [...(apt.interactions ?? []), { date: dateHe, type: 'ביקור', notes: esc(p.note ?? ev.text ?? ''), result: String(p.result ?? ''), source: 'field' }];
      apt.updatedAt = Date.now();
    }
    return true;
  }
  if (!ev.bldg) return false;

  if (ev.type === 'new_family' || ev.type === 'add_full_family') {
    let b = getBuilding(db, ev.bldg);
    if (!b || b.info.movedTo || b.info.deletedAt) {
      db[ev.bldg] = { info: { code: '', rep: '', notes: '', coords: (p.coords as [number, number] | undefined) ?? null, updatedAt: Date.now() }, apts: b?.apts ?? [] };
      b = getBuilding(db, ev.bldg)!;
    }
    if (ev.payload) b.apts.push({ ...(p as Apartment), id: String(p.id ?? `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`), updatedAt: Date.now() });
    return true;
  }

  const b = getBuilding(db, ev.bldg);
  if (!b) return false;
  let apt: Apartment | undefined = ev.aptName
    ? b.apts.find((a) => !a.deletedAt && a.name === ev.aptName && (ev.aptNum === undefined || String(a.num) === String(ev.aptNum)))
    : undefined;
  if (!apt && typeof ev.aptIdx === 'number') apt = b.apts[ev.aptIdx];
  if (!apt || apt.deletedAt) return false;
  if (ev.type === 'delete_family') { softDeleteApt(apt); return true; }

  const tasks = () => ((apt!.tasks ??= []) as Task[]);
  switch (ev.type) {
    case 'task_done':
    case 'task_undone': {
      const done = ev.type === 'task_done';
      let t = typeof ev.taskIdx === 'number' ? tasks()[ev.taskIdx] : undefined;
      if (!t) t = tasks().find((x) => x.text === p.taskText && !!x.done !== done);
      if (t) { t.done = done; if (done) t.doneAt = ts; else delete t.doneAt; }
      break;
    }
    case 'add_family_task': tasks().push({ text: String(p.taskText ?? ''), date: String(p.taskDate ?? ''), done: false }); break;
    case 'visit_log': apt.interactions = [...(apt.interactions ?? []), { date: dateHe, type: 'ביקור', notes: esc(p.note), result: String(p.result ?? ''), source: 'field' }]; break;
    case 'call_log': apt.interactions = [...(apt.interactions ?? []), { date: dateHe, type: 'שיחה', notes: esc(p.note), source: 'field' }]; break;
    case 'stage_change': apt.boards = { ...((apt.boards ?? {}) as Record<string, string>), [String(p.boardId)]: String(p.stage ?? '') }; break;
    case 'quick_status': apt.status = p.status; break;
    case 'edit_family': {
      const skip = ['tasks', 'interactions', 'history', 'donations', 'boards', 'tags', 'customFields'];
      for (const [k, v] of Object.entries(p)) {
        if (skip.includes(k)) continue;
        if (k === 'childrenList') {
          // ילדים מהשטח גוברים; ילדים שהוספו במשרד נשמרים
          const merged = [...((v ?? []) as { name?: string }[])];
          for (const dc of (apt.childrenList ?? []) as { name?: string }[]) if (dc.name && !merged.some((f) => f.name === dc.name)) merged.push(dc);
          apt.childrenList = merged;
        } else (apt as Record<string, unknown>)[k] = v;
      }
      break;
    }
    case 'tag_add': if (ev.tag && !(apt.tags ?? []).includes(ev.tag)) apt.tags = [...(apt.tags ?? []), ev.tag]; break;
    case 'add_donation': if (ev.payload) apt.donations = [...(apt.donations ?? []), { ...(p as object) }]; break;
    case 'delete_log': {
      const logs = (apt.interactions ?? []) as { date?: string; text?: string; notes?: string }[];
      let i = logs.findIndex((l) => l.date === p.date && (l.text === p.text || l.notes === p.text || l.text === p.notes));
      if (i === -1 && typeof ev.logIdx === 'number') i = ev.logIdx;
      if (i >= 0 && i < logs.length) apt.interactions = logs.filter((_, j) => j !== i) as Apartment['interactions'];
      break;
    }
    case 'delete_task': {
      let i = p.text ? tasks().findIndex((t) => t.text === p.text && !t.done === !p.done) : -1;
      if (i === -1 && typeof ev.taskIdx === 'number') i = ev.taskIdx;
      if (i >= 0 && i < tasks().length) apt.tasks = tasks().filter((_, j) => j !== i);
      break;
    }
    case 'contact_update': {
      const { field, value, attribution } = ev;
      if (field === 'phone' || field === 'phone2') {
        if (attribution === 'father') apt.fatherPhone = value;
        else if (attribution === 'mother') apt.motherPhone = value;
        else if (attribution?.startsWith('child:')) {
          const c = ((apt.childrenList ?? []) as { name?: string; phone?: string }[]).find((x) => x.name === attribution.slice(6));
          if (c) c.phone = value;
        } else apt.phone = value;
      }
      if (field === 'email') {
        if (attribution === 'father') apt.fatherEmail = value;
        else if (attribution === 'mother') apt.motherEmail = value;
        else apt.email = value;
      }
      break;
    }
    default:
      return false;
  }
  apt.updatedAt = Date.now();
  return true;
}

export interface OutboxFile { id: string; payload: { events?: FieldEvent[]; deviceId?: string; createdAt?: string } }

/**
 * מחיל קבצי עדכון; מחזיר כמה יושמו ואילו קבצים אפשר להעביר לסל
 * (גם קובץ שכל האירועים בו כבר יושמו בעבר).
 */
export function applyOutbox(db: Db, files: OutboxFile[], now = Date.now()): { applied: number; trash: string[] } {
  const s = (db.__SETTINGS__ ??= {});
  const done = ((s.appliedEventIds ??= {}) as Record<string, number>);
  const seen = new Set<string>();
  let applied = 0;
  const trash: string[] = [];
  for (const f of files) {
    const fresh = (f.payload.events ?? []).filter((ev) => {
      if (done[fieldEventId(ev)]) return false;
      const k = `${ev.type}_${ev.bldg}_${ev.aptName}_${JSON.stringify(ev.payload)}`;
      // כפילות תוכן (לחיצה כפולה בשטח) — נרשמת כמטופלת, כדי שלא תוחל בסבב הבא אם הקובץ לא נמחק
      if (seen.has(k)) { done[fieldEventId(ev)] = now; return false; }
      seen.add(k);
      return true;
    });
    if (!fresh.length) { trash.push(f.id); continue; }
    let any = false;
    for (const ev of fresh) {
      if (applyFieldEvent(db, ev)) { applied++; any = true; done[fieldEventId(ev)] = now; }
    }
    if (any) trash.push(f.id);
  }
  for (const [id, t] of Object.entries(done)) if (t < now - 30 * 86400000) delete done[id];
  if (applied) s.updatedAt = now;
  return { applied, trash };
}

/** משיכת קבצי העדכון מהדרייב (ללא שינוי בנתונים) */
export async function fetchOutbox(sync: DriveSync): Promise<OutboxFile[]> {
  const list = await sync.listFieldUpdates();
  const files: OutboxFile[] = [];
  for (const f of list) {
    try { files.push({ id: f.id, payload: await sync.downloadJson(f.id) }); } catch { /* קובץ פגום — מדלגים */ }
  }
  return files;
}
