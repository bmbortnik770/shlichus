/**
 * הודעות, חיוג, תבניות, מעגלים וסגמנטים — אותם מבנים כמו במערכת הקיימת:
 * __SETTINGS__.templates [{title,text}], __SETTINGS__.connectionCircles [{id,label,emoji}],
 * apt.connectionCircles [{id, member}] (גם מחרוזות מגרסאות ביניים), __SETTINGS__.savedSegments [{name, keys: ["bldg|idx"]}].
 */
import type { Apartment, Db, InteractionLog } from './types.js';
import { getBuilding } from './types.js';
import { type FamilyRef, familyPhones, listFamilies, updateFamily } from './families.js';
import { displayName, lastContact } from './today.js';
import { daysBetween } from './dates.js';

export type Channel = 'whatsapp' | 'sms' | 'email';
export interface Template { title: string; text: string }
export interface Circle { id: string; label?: string; name?: string; emoji?: string }
/** שם המעגל — "label" במערכת הקיימת ("name" בגרסת ביניים) */
export const circleName = (c: Circle) => (c.label ?? c.name ?? '').trim() || 'מעגל';
export interface Segment { name: string; keys: string[] }
export interface Recipient extends FamilyRef {
  key: string; name: string; phone: string; email: string; style: string; tags: string[];
  circles: string[]; daysSince: number | null; openTasks: boolean;
}

const DAY = 86400000;
export const refKey = (r: FamilyRef) => `${r.bldg}|${r.idx}`;

const stamp = (d = new Date()) => `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;

/** "[שם]" → שם המשפחה (או שם האב/האם) */
export function personalize(text: string, apt: Pick<Apartment, 'name' | 'father' | 'mother'>): string {
  const name = apt.name?.trim() || apt.father?.trim() || apt.mother?.trim() || '';
  return text.replace(/\[\s*שם\s*\]/g, name || 'משפחה יקרה').replace(/משפחת משפחה יקרה/g, 'משפחה יקרה');
}

export function circleIds(apt: Apartment): string[] {
  return ((apt.connectionCircles ?? []) as (string | { id?: string })[]).map((e) => (typeof e === 'string' ? e : e.id ?? '')).filter(Boolean);
}

/** כל מי שאפשר להגיע אליו בערוץ — וואטסאפ/SMS דורשים טלפון, מייל דורש כתובת */
export function recipients(db: Db, channel: Channel, now = new Date()): Recipient[] {
  const out: Recipient[] = [];
  for (const r of listFamilies(db)) {
    const a = r.apt;
    const phone = familyPhones(a)[0] ?? '';
    const email = String(a.fatherEmail || a.motherEmail || '');
    if (channel === 'email' ? !email : !phone) continue;
    const last = lastContact(a);
    out.push({
      bldg: r.bldg, idx: r.idx, key: refKey(r), name: displayName(a) || r.bldg, phone, email, style: a.style ?? '', tags: a.tags ?? [],
      circles: circleIds(a), daysSince: last ? daysBetween(last, now) : null,
      openTasks: (a.tasks ?? []).some((t) => !t.done),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** קישור שליחה מוכן לערוץ */
export function sendLink(channel: Channel, r: Pick<Recipient, 'phone' | 'email'>, text: string, subject = 'הודעה מבית חב"ד'): string {
  if (channel === 'email') return `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const digits = r.phone.replace(/\D/g, '');
  if (channel === 'sms') return `sms:${r.phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}`;
  const intl = digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

const CHANNEL_TYPE: Record<Channel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'מייל' };

/** תיעוד הודעה שנשלחה — אותו פורמט כמו comm_hub במערכת הקיימת (נספר בניקוד הקשר) */
export function logSent(db: Db, ref: FamilyRef, channel: Channel, text: string): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const log: InteractionLog = { date: stamp(), type: CHANNEL_TYPE[channel], notes: text.slice(0, 120), channel, source: 'comm_hub', result: '' };
  updateFamily(db, ref, { interactions: [log, ...(apt.interactions ?? [])] });
}

/** תיעוד שיחת טלפון ותוצאתה */
export function logCall(db: Db, ref: FamilyRef, result: string, note = ''): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const log: InteractionLog = { date: stamp(), type: 'שיחה', notes: [result, note].filter(Boolean).join(' · '), channel: 'phone', source: 'comm_hub', result };
  updateFamily(db, ref, { interactions: [log, ...(apt.interactions ?? [])] });
}

export const getTemplates = (db: Db) => ((db.__SETTINGS__?.templates ?? []) as Template[]).filter((t) => t && (t.title || t.text));
export const getCircles = (db: Db) => ((db.__SETTINGS__?.connectionCircles ?? []) as Circle[]).filter((c) => c && c.id);
export const getSegments = (db: Db) => ((db.__SETTINGS__?.savedSegments ?? []) as Segment[]).filter((s) => s && s.name);

export function setSetting(db: Db, patch: Record<string, unknown>): void {
  db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), ...patch, updatedAt: Date.now() };
}

/** הוספה/הסרה ממעגל — באותו מבנה כמו circles-hub במערכת הקיימת ({id, member}) */
export function setCircleMember(db: Db, ref: FamilyRef, circleId: string, member: boolean, who = 'family'): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const entries = ((apt.connectionCircles ?? []) as (string | { id?: string; member?: string })[])
    .filter((e) => (typeof e === 'string' ? e : e.id) !== circleId);
  updateFamily(db, ref, { connectionCircles: member ? [...entries, { id: circleId, member: who }] : entries });
}

export function newCircle(db: Db, label: string): string {
  const id = `circle_${Date.now()}`;
  setSetting(db, { connectionCircles: [...getCircles(db), { id, label, emoji: '🔵' }] });
  return id;
}

/** כמה הודעות יצאו מהמרכז ב-n הימים האחרונים */
export function sentCount(db: Db, days = 30, now = new Date()): number {
  let n = 0;
  for (const r of listFamilies(db)) {
    for (const l of r.apt.interactions ?? []) {
      if (l.source !== 'comm_hub' || l.channel === 'phone') continue;
      const d = lastContact({ interactions: [l] } as Apartment);
      if (d && now.getTime() - d.getTime() <= days * DAY) n++;
    }
  }
  return n;
}
