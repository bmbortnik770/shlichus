/**
 * ניקוד קשר וצבעי סטטוס — העתק התנהגותי מדויק של getAptScore/getStatusColor בישן.
 */
import type { Apartment, AppSettings } from './types.js';

export interface ScoringChannel { key: string; label?: string; points: number; ttlDays: number }
export interface ScoringRules {
  thresholds: { green: number; orange: number };
  channels: ScoringChannel[];
}

/** ברירות המחדל של המערכת הקיימת — אותם ערכים בדיוק */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  thresholds: { green: 60, orange: 25 },
  channels: [
    { key: 'visit', label: 'ביקור בית', points: 50, ttlDays: 90 },
    { key: 'phone', label: 'שיחת טלפון', points: 30, ttlDays: 60 },
    { key: 'whatsapp', label: 'WhatsApp', points: 20, ttlDays: 30 },
    { key: 'sms', label: 'SMS', points: 20, ttlDays: 30 },
    { key: 'email', label: 'מייל', points: 10, ttlDays: 30 },
  ],
};

const TYPE_TO_KEY: Record<string, string> = {
  WhatsApp: 'whatsapp', 'מייל': 'email', SMS: 'sms', 'שיחה': 'phone', 'ביקור': 'visit',
};

function rules(settings: AppSettings | undefined): ScoringRules {
  const r = settings?.scoringRules as ScoringRules | undefined;
  return r?.channels?.length ? r : DEFAULT_SCORING_RULES;
}

/** ‎-1 = אין קשר מעולם; אחרת סכום נקודות ערוצים בתוך חלון ה-ttl */
export function getAptScore(a: Apartment, settings?: AppSettings): number {
  const logs = a.interactions ?? [];
  if (!logs.length) return -1;
  const chans = rules(settings).channels;
  const now = Date.now();
  let score = 0;
  for (const log of logs) {
    const ch = String(log.channel ?? TYPE_TO_KEY[String(log.type ?? '')] ?? '');
    const rule = chans.find((r) => r.key === ch);
    if (!rule) continue;
    const t = new Date(String(log.date ?? '')).getTime();
    if (!t) continue;
    if ((now - t) / 86400000 <= rule.ttlDays) score += rule.points;
  }
  return score;
}

/** אפור=אין קשר · ירוק≥green · כתום≥orange · אדום מתחת */
export function getStatusColor(a: Apartment, settings?: AppSettings): string {
  const score = getAptScore(a, settings);
  if (score < 0) return '#94a3b8';
  const t = (settings?.scoringRules as ScoringRules | undefined)?.thresholds ?? DEFAULT_SCORING_RULES.thresholds;
  if (score >= t.green) return '#10b981';
  if (score >= t.orange) return '#f59e0b';
  return '#ef4444';
}

/** דרגת חומרה 0-3 לבניין (הצבע ה"חמור" מבין הדירות) — כמו maxVal ב-refreshMap */
export function statusSeverity(color: string): number {
  return color === '#94a3b8' ? 0 : color === '#10b981' ? 1 : color === '#f59e0b' ? 2 : 3;
}
export const SEVERITY_COLORS = ['#94a3b8', '#10b981', '#f59e0b', '#ef4444'] as const;
