/**
 * תצוגות חכמות וסינון נתונים חסרים — כל הכללים של המערכת הקיימת (app.js):
 * child_age, no_interaction, has_open_tasks, in_project, no_visit_3m, bday_month,
 * no_visit_months, no_call_months, has_tag. מבנה: __SETTINGS__.smartViews [{id, name, rule, param1, param2, value}].
 */
import type { Apartment } from './types.js';
import { NO_ADDRESS_KEY } from './types.js';
import { familyPhones } from './families.js';
import { parseLooseDate } from './dates.js';

export interface SmartView { id: string; name: string; rule: string; param1?: string; param2?: string; value?: string }

export const SMART_RULES: { rule: string; label: string; params: ('age' | 'type' | 'months' | 'board' | 'tag')[] }[] = [
  { rule: 'no_interaction', label: 'בלי קשר כבר X חודשים', params: ['type', 'months'] },
  { rule: 'no_visit_months', label: 'בלי ביקור X חודשים', params: ['months'] },
  { rule: 'no_call_months', label: 'בלי שיחה X חודשים', params: ['months'] },
  { rule: 'has_open_tasks', label: 'יש משימה פתוחה', params: [] },
  { rule: 'in_project', label: 'משתתפים בלוח', params: ['board'] },
  { rule: 'has_tag', label: 'עם תגית', params: ['tag'] },
  { rule: 'child_age', label: 'יש ילד בגיל X', params: ['age'] },
  { rule: 'bday_month', label: 'יום הולדת של ילד החודש', params: [] },
];

const MONTH = 1000 * 60 * 60 * 24 * 30;

function lastOf(apt: Apartment, type?: string): Date | null {
  let max: Date | null = null;
  for (const l of apt.interactions ?? []) {
    if (type && l.type !== type) continue;
    const d = parseLooseDate(l.date);
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

export function matchSmartView(apt: Apartment, v: SmartView | undefined, now = new Date()): boolean {
  if (!v) return true;
  const kids = (apt.childrenList ?? []) as { dob?: string }[];
  switch (v.rule) {
    case 'child_age': {
      const age = parseInt(v.param1 || v.value || '', 10);
      return kids.some((c) => c.dob && now.getFullYear() - new Date(c.dob).getFullYear() === age);
    }
    case 'no_interaction': {
      const type = v.param1 && v.param1 !== 'כלשהו' ? v.param1 : undefined;
      const last = lastOf(apt, type);
      return !last || (now.getTime() - last.getTime()) / MONTH >= parseInt(v.param2 || v.value || '3', 10);
    }
    case 'has_open_tasks': return (apt.tasks ?? []).some((t) => !t.done);
    case 'in_project': return !!(apt.boards && (apt.boards as Record<string, unknown>)[v.param1 ?? ''] !== undefined);
    case 'no_visit_3m': { const l = lastOf(apt, 'ביקור'); return !l || (now.getTime() - l.getTime()) / MONTH > 3; }
    case 'bday_month': return kids.some((c) => c.dob && new Date(c.dob).getMonth() === now.getMonth());
    case 'no_visit_months':
    case 'no_call_months': {
      const l = lastOf(apt, v.rule === 'no_visit_months' ? 'ביקור' : 'שיחה');
      return !l || (now.getTime() - l.getTime()) / MONTH >= parseInt(v.value || v.param1 || '3', 10);
    }
    case 'has_tag': return (apt.tags ?? []).includes(v.value ?? v.param1 ?? '');
    default: return true;
  }
}

export const MISSING_FIELDS = [
  { key: 'phone', label: 'טלפון' }, { key: 'email', label: 'מייל' }, { key: 'address', label: 'כתובת' },
  { key: 'style', label: 'סגנון' }, { key: 'notes', label: 'הערות' }, { key: 'tags', label: 'תגיות' },
] as const;

/** חסר לפחות אחד מהשדות שנבחרו (OR, כמו בישן). שדה מותאם: "custom_<שם>" */
export function missingAny(apt: Apartment, bldg: string, fields: string[]): boolean {
  if (!fields.length) return true;
  return fields.some((f) => {
    if (f === 'phone') return familyPhones(apt).length === 0;
    if (f === 'email') return ![apt.fatherEmail, apt.motherEmail, apt.email].some((e) => String(e ?? '').includes('@'));
    if (f === 'address') return bldg === NO_ADDRESS_KEY;
    if (f === 'style') return !apt.style;
    if (f === 'notes') return !String(apt.notes ?? '').trim();
    if (f === 'tags') return !(apt.tags ?? []).length;
    if (f.startsWith('custom_')) return !((apt.customData ?? apt.customFields ?? {}) as Record<string, unknown>)[f.slice(7)];
    return false;
  });
}
