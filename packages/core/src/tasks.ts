/**
 * משימות — כלליות (meta.generalTasks, גם מאפליקציית השטח) ומשימות של משפחה (apt.tasks).
 * מבנה זהה למערכת הקיימת.
 */
import type { Db, Task } from './types.js';
import { getBuilding } from './types.js';
import { type FamilyRef, listFamilies, updateFamily } from './families.js';
import { displayName } from './today.js';
import { parseLooseDate } from './dates.js';

export interface TaskRow {
  /** מזהה יציב לרינדור */
  id: string;
  text: string;
  /** YYYY-MM-DD או ריק */
  due: string;
  done: boolean;
  /** משימה כללית: האינדקס ב-generalTasks; משימת משפחה: המשפחה והאינדקס */
  general?: number;
  family?: FamilyRef & { name: string; t: number };
}

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'done';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** תאריך יעד אחיד (גם "6.7.2026" מהשטח) */
export function normalizeDue(v: unknown): string {
  const d = parseLooseDate(v);
  return d ? iso(d) : '';
}

export function listTasks(db: Db): TaskRow[] {
  const out: TaskRow[] = [];
  ((db.meta?.generalTasks ?? []) as { text?: string; date?: string; done?: boolean }[]).forEach((t, i) => {
    out.push({ id: `g${i}`, text: String(t.text ?? ''), due: normalizeDue(t.date), done: !!t.done, general: i });
  });
  for (const r of listFamilies(db)) {
    ((r.apt.tasks ?? []) as Task[]).forEach((t, ti) => {
      out.push({
        id: `f${r.bldg}|${r.idx}|${ti}`, text: String(t.text ?? ''), due: normalizeDue(t.due ?? t.date), done: !!t.done,
        family: { bldg: r.bldg, idx: r.idx, t: ti, name: displayName(r.apt) || r.bldg },
      });
    });
  }
  return out.filter((t) => t.text.trim());
}

export function taskGroup(t: TaskRow, now = new Date()): TaskGroup {
  if (t.done) return 'done';
  if (!t.due) return 'nodate';
  const today = iso(now);
  if (t.due < today) return 'overdue';
  if (t.due === today) return 'today';
  const week = new Date(now);
  week.setDate(week.getDate() + 7);
  return t.due <= iso(week) ? 'week' : 'later';
}

export function setTaskDone(db: Db, t: TaskRow, done: boolean): void {
  if (t.general !== undefined) {
    const list = [...((db.meta?.generalTasks ?? []) as { done?: boolean }[])];
    if (!list[t.general]) return;
    list[t.general] = { ...list[t.general], done };
    db.meta = { ...(db.meta ?? { lastModified: 0 }), generalTasks: list };
    return;
  }
  if (t.family) {
    const apt = getBuilding(db, t.family.bldg)?.apts[t.family.idx];
    if (!apt) return;
    const tasks = ((apt.tasks ?? []) as Task[]).map((x, i) => (i === t.family!.t ? { ...x, done } : x));
    updateFamily(db, t.family, { tasks });
  }
}

/** משימה חדשה: לבחירת משפחה — למשפחה, אחרת כללית (אותו מבנה כמו add_general_task מהשטח) */
export function addTask(db: Db, text: string, due: string, family?: FamilyRef): void {
  if (family) {
    const apt = getBuilding(db, family.bldg)?.apts[family.idx];
    if (!apt) return;
    updateFamily(db, family, { tasks: [...((apt.tasks ?? []) as Task[]), { text, due, done: false }] });
    return;
  }
  db.meta = { ...(db.meta ?? { lastModified: 0 }), generalTasks: [...((db.meta?.generalTasks ?? []) as unknown[]), { text, date: due, done: false }] };
}
