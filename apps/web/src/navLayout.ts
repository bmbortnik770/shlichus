import type { Db } from '@shlichus/core';
import type { IconName } from './icons';
import type { View } from './nav';

/**
 * סידור התפריט — כל משתמש מסדר לעצמו: קבוצות, סדר, הסתרה, וכפתורי הסרגל בטלפון.
 * נשמר ב-__SETTINGS__.navLayouts[<מייל המשתמש>] כדי שיעבור בין המחשב לטלפון.
 */
export type ScreenKey = Exclude<View, 'activity' | 'more'>;
export interface NavGroup { id: string; label: string; items: ScreenKey[]; foot?: boolean }
/** כפתור בסרגל התחתון: מסך, או קבוצה ("group:<id>") שנפתחת כמסך קצר */
export type MobileEntry = ScreenKey | `group:${string}`;
export interface NavLayout { groups: NavGroup[]; hidden: ScreenKey[]; mobile: MobileEntry[] }

export const SCREENS: Record<ScreenKey, { label: string; icon: IconName }> = {
  today: { label: 'היום', icon: 'sun' },
  community: { label: 'הקהילה', icon: 'map' },
  messages: { label: 'הודעות', icon: 'chat' },
  tasks: { label: 'משימות ופרויקטים', icon: 'tasks' },
  events: { label: 'אירועים', icon: 'cal' },
  donations: { label: 'תרומות', icon: 'heart' },
  connections: { label: 'חיבורים', icon: 'plug' },
  settings: { label: 'הגדרות', icon: 'gear' },
};
const ALL = Object.keys(SCREENS) as ScreenKey[];
/** הגדרות תמיד נשארות גלויות — כדי שאי אפשר יהיה להינעל מחוץ לסידור */
export const UNHIDEABLE: ScreenKey[] = ['settings'];
export const MOBILE_SLOTS = 4;

export const DEFAULT_LAYOUT: NavLayout = {
  groups: [
    { id: 'main', label: '', items: ['today', 'community', 'messages'] },
    { id: 'activity', label: 'פעילות', items: ['tasks', 'events', 'donations'] },
    { id: 'foot', label: '', items: ['connections', 'settings'], foot: true },
  ],
  hidden: [],
  mobile: ['today', 'community', 'messages', 'group:activity'],
};

const clone = (l: NavLayout): NavLayout => JSON.parse(JSON.stringify(l)) as NavLayout;

/** תיקון סידור שמור: כל מסך מופיע פעם אחת בדיוק; מסכים חדשים נכנסים לקבוצה הראשונה */
export function normalize(raw: unknown): NavLayout {
  const l = raw && typeof raw === 'object' && Array.isArray((raw as NavLayout).groups) ? clone(raw as NavLayout) : clone(DEFAULT_LAYOUT);
  const seen = new Set<ScreenKey>();
  l.groups = l.groups.filter((g) => g && g.id).map((g) => ({ ...g, label: String(g.label ?? ''), items: (g.items ?? []).filter((k) => ALL.includes(k) && !seen.has(k) && (seen.add(k), true)) }));
  l.hidden = (l.hidden ?? []).filter((k) => ALL.includes(k) && !UNHIDEABLE.includes(k));
  for (const k of l.hidden) {
    if (seen.has(k)) { for (const g of l.groups) g.items = g.items.filter((x) => x !== k); }
    seen.add(k);
  }
  if (!l.groups.length) l.groups = clone(DEFAULT_LAYOUT).groups;
  for (const k of ALL) if (!seen.has(k)) l.groups[0]!.items.push(k);
  const groupIds = new Set(l.groups.map((g) => g.id));
  l.mobile = (l.mobile ?? []).filter((m, i, a) => a.indexOf(m) === i && (m.startsWith('group:') ? groupIds.has(m.slice(6)) : ALL.includes(m as ScreenKey) && !l.hidden.includes(m as ScreenKey))).slice(0, MOBILE_SLOTS);
  return l;
}

export function userKey(): string {
  try { return localStorage.getItem('shlichus_user_email') || 'default'; } catch { return 'default'; }
}

export function getLayout(db: Db): NavLayout {
  const all = (db.__SETTINGS__?.navLayouts ?? {}) as Record<string, unknown>;
  return normalize(all[userKey()] ?? all.default);
}

export function setLayout(db: Db, layout: NavLayout | null): void {
  const all = { ...((db.__SETTINGS__?.navLayouts ?? {}) as Record<string, unknown>) };
  if (layout) all[userKey()] = normalize(layout); else delete all[userKey()];
  db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), navLayouts: all, updatedAt: Date.now() };
}

export const entryLabel = (l: NavLayout, m: MobileEntry) => (m.startsWith('group:') ? l.groups.find((g) => g.id === m.slice(6))?.label || 'קבוצה' : SCREENS[m as ScreenKey].label);
export const entryIcon = (m: MobileEntry): IconName => (m.startsWith('group:') ? 'tasks' : SCREENS[m as ScreenKey].icon);

/** איזה כפתור בסרגל התחתון מסומן במסך הנוכחי */
export function mobileOwner(l: NavLayout, view: View, hubId: string): MobileEntry | 'more' {
  if (view === 'activity') return l.mobile.includes(`group:${hubId}`) ? `group:${hubId}` : 'more';
  if (l.mobile.includes(view as ScreenKey)) return view as ScreenKey;
  const g = l.groups.find((x) => x.items.includes(view as ScreenKey));
  if (g && l.mobile.includes(`group:${g.id}`)) return `group:${g.id}`;
  return 'more';
}

/* ───────── נתוני שימוש: לאן נכנסים, כדי להציע סידור ───────── */

const USAGE_KEY = 'shlichus_nav_usage';
const DISMISS_KEY = 'shlichus_nav_suggest_off';
export function recordVisit(view: View): void {
  if (!(ALL as string[]).includes(view)) return;
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') as Record<string, number>;
    u[view] = (u[view] ?? 0) + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch { /* */ }
}
export function usage(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') as Record<string, number>; } catch { return {}; }
}

/** הצעה: מסך שנכנסים אליו הרבה ואינו בסרגל הטלפון — במקום הכפתור הכי פחות בשימוש */
export function suggestion(l: NavLayout): { add: ScreenKey; replace: MobileEntry; count: number } | null {
  const u = usage();
  let off: string[] = [];
  try { off = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]; } catch { /* */ }
  const reach = (m: MobileEntry) => (m.startsWith('group:') ? (l.groups.find((g) => g.id === m.slice(6))?.items ?? []).reduce((s, k) => s + (u[k] ?? 0), 0) : u[m] ?? 0);
  const inBar = new Set<ScreenKey>(l.mobile.flatMap((m) => (m.startsWith('group:') ? l.groups.find((g) => g.id === m.slice(6))?.items ?? [] : [m as ScreenKey])));
  const cand = ALL.filter((k) => !inBar.has(k) && !l.hidden.includes(k) && !off.includes(k) && (u[k] ?? 0) >= 8).sort((a, b) => (u[b] ?? 0) - (u[a] ?? 0))[0];
  if (!cand) return null;
  if (l.mobile.length < MOBILE_SLOTS) return { add: cand, replace: '' as MobileEntry, count: u[cand] ?? 0 };
  const weakest = [...l.mobile].sort((a, b) => reach(a) - reach(b))[0]!;
  return (u[cand] ?? 0) > reach(weakest) * 1.5 ? { add: cand, replace: weakest, count: u[cand] ?? 0 } : null;
}
export function dismissSuggestion(k: ScreenKey): void {
  try {
    const off = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[];
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...off, k]));
  } catch { /* */ }
}
export function applySuggestion(l: NavLayout, s: { add: ScreenKey; replace: MobileEntry }): NavLayout {
  const n = clone(l);
  n.mobile = s.replace ? n.mobile.map((m) => (m === s.replace ? s.add : m)) : [...n.mobile, s.add];
  return n;
}
