/**
 * סוגי פעילות וציון מעורבות — העתק של scoring.js במערכת הקיימת:
 * __SETTINGS__.interactionTypes [{key,label,icon,color,direction,defaultScore}],
 * scoreWeights {key: נקודות}, scoreDecayDays (זמן מחצית).
 * רישום פעילות: {date, type: label, interactionType: key, text, member, direction}.
 */
import type { Apartment, AppSettings, InteractionLog } from './types.js';
import { parseLooseDate } from './dates.js';

export type Direction = 'outgoing' | 'incoming' | 'milestone';
export interface InteractionType { key: string; label: string; icon?: string; color: string; direction: Direction; defaultScore: number }

export const DIRECTION_LABELS: Record<Direction, string> = { outgoing: 'יזום', incoming: 'הגיעו אלינו', milestone: 'אבן דרך' };

export const DEFAULT_INTERACTION_TYPES: InteractionType[] = [
  { key: 'tefillin', label: 'הנחת תפילין', icon: 'fa-scroll-torah', color: '#1d4ed8', direction: 'outgoing', defaultScore: 15 },
  { key: 'mezuzah', label: 'בדיקת מזוזות', icon: 'fa-door-open', color: '#059669', direction: 'outgoing', defaultScore: 20 },
  { key: 'visit', label: 'ביקור בית', icon: 'fa-home', color: '#7c3aed', direction: 'outgoing', defaultScore: 10 },
  { key: 'call', label: 'שיחת טלפון', icon: 'fa-phone', color: '#0891b2', direction: 'outgoing', defaultScore: 8 },
  { key: 'message', label: 'הודעה / מייל', icon: 'fa-envelope', color: '#6b7280', direction: 'outgoing', defaultScore: 5 },
  { key: 'mourning', label: 'ניחום אבלים', icon: 'fa-heart-broken', color: '#374151', direction: 'outgoing', defaultScore: 25 },
  { key: 'hospital', label: 'ביקור חולים', icon: 'fa-hospital', color: '#dc2626', direction: 'outgoing', defaultScore: 20 },
  { key: 'shiur', label: 'שיעור', icon: 'fa-book-open', color: '#d97706', direction: 'incoming', defaultScore: 12 },
  { key: 'event', label: 'אירוע / חג', icon: 'fa-calendar-star', color: '#db2777', direction: 'incoming', defaultScore: 8 },
  { key: 'prayer', label: 'תפילה / מניין', icon: 'fa-synagogue', color: '#6d28d9', direction: 'incoming', defaultScore: 10 },
  { key: 'donation', label: 'תרומה', icon: 'fa-shekel-sign', color: '#16a34a', direction: 'incoming', defaultScore: 6 },
  { key: 'good_resolution', label: 'החלטה טובה', icon: 'fa-star', color: '#f59e0b', direction: 'milestone', defaultScore: 20 },
  { key: 'other', label: 'אחר', icon: 'fa-circle', color: '#94a3b8', direction: 'milestone', defaultScore: 5 },
];
const DEFAULT_DECAY_DAYS = 90;

export function getInteractionTypes(s?: AppSettings): InteractionType[] {
  const list = s?.interactionTypes as InteractionType[] | undefined;
  return list?.length ? list : DEFAULT_INTERACTION_TYPES;
}

export function scoreWeights(s?: AppSettings): Record<string, number> {
  const w = s?.scoreWeights as Record<string, number> | undefined;
  if (w && Object.keys(w).length) return w;
  return Object.fromEntries(getInteractionTypes(s).map((t) => [t.key, t.defaultScore]));
}

/** מילות מפתח לרישומים ישנים בלי interactionType (כמו _guessKey) */
const GUESS: [RegExp, string][] = [
  [/תפילין/, 'tefillin'], [/מזוז/, 'mezuzah'], [/ביקור חולים/, 'hospital'], [/ניחום|אבל/, 'mourning'],
  [/ביקור/, 'visit'], [/שיחה|טלפון|phone|call/i, 'call'], [/whatsapp|וואטסאפ|הודעה|מייל|sms|email/i, 'message'],
  [/שיעור/, 'shiur'], [/אירוע|חג/, 'event'], [/תפיל|מניין/, 'prayer'], [/תרומ/, 'donation'], [/החלטה/, 'good_resolution'],
];
export function guessTypeKey(label: string | undefined): string {
  const s = String(label ?? '');
  return GUESS.find(([re]) => re.test(s))?.[1] ?? 'other';
}

export function typeInfo(s: AppSettings | undefined, keyOrLabel: string | undefined): InteractionType {
  const v = String(keyOrLabel ?? '');
  return getInteractionTypes(s).find((t) => t.key === v || t.label === v)
    ?? { key: 'other', label: v || 'אחר', color: '#94a3b8', direction: 'milestone', defaultScore: 5 };
}

export const logTypeKey = (l: InteractionLog) => String(l.interactionType ?? guessTypeKey(String(l.type ?? '')));

/** ערוץ לניקוד הסטטוס (ביקור/שיחה/וואטסאפ) — כדי שגם סוגים מותאמים יצבעו את הסטטוס */
const CHANNEL_OF: Record<string, string> = { visit: 'visit', tefillin: 'visit', mezuzah: 'visit', mourning: 'visit', hospital: 'visit', call: 'phone', message: 'whatsapp' };

export function makeLog(s: AppSettings | undefined, p: { date: string; typeKey: string; text: string; member?: string }): InteractionLog {
  const t = typeInfo(s, p.typeKey);
  const log: InteractionLog = { date: p.date, type: t.label, interactionType: t.key, text: p.text, member: p.member || 'family', direction: t.direction };
  const ch = CHANNEL_OF[t.key];
  if (ch) log.channel = ch;
  return log;
}

/** ציון מעורבות 0–100 עם דעיכה (כמו computeEngagementScore) */
export function engagementScore(apt: Apartment, s?: AppSettings, now = Date.now()): number {
  const w = scoreWeights(s);
  const decay = Number(s?.scoreDecayDays) > 0 ? Number(s?.scoreDecayDays) : DEFAULT_DECAY_DAYS;
  let score = 0;
  for (const i of apt.interactions ?? []) {
    const key = logTypeKey(i);
    const pts = w[key] ?? w.other ?? 5;
    const t = parseLooseDate(i.date)?.getTime();
    const days = t ? Math.max(0, (now - t) / 86400000) : 0;
    score += pts * Math.pow(0.5, Math.min(days / decay, 1000));
  }
  return Math.min(100, Math.round(score));
}

export function engagementLabel(score: number): { label: string; level: 'hot' | 'warm' | 'cool' | 'cold' } {
  if (score >= 70) return { label: 'מעורב מאוד', level: 'hot' };
  if (score >= 40) return { label: 'מתחמם', level: 'warm' };
  if (score >= 15) return { label: 'מתרחק', level: 'cool' };
  return { label: 'קר', level: 'cold' };
}
