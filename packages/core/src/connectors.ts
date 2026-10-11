/**
 * שכבת החיבורים — כל חיבור למערכת חיצונית הוא מודול שכל לקוח מפעיל לעצמו.
 *
 * עקרונות (החלטת מוצר 11.10.2026):
 * - חיבור חינמי שלא דורש שרת → פעיל כברירת מחדל ("בלי שאלות").
 * - חיבור שעולה כסף או דורש שרת → כבוי עד שהלקוח מפעיל, ומוצג עם החבילה הנדרשת.
 * - ההגדרות נשמרות ב-__SETTINGS__.connectors כך שהן נשמרות ומסתנכרנות עם שאר הנתונים.
 */
import type { AppSettings } from './types.js';

/** חבילה: free = דרייב בלבד; pro = שרת (ריבוי משתמשים, קבלת הודעות מבחוץ) */
export type Plan = 'free' | 'pro';

export type ConnectorCategory = 'messages' | 'calendar' | 'payments' | 'data';

export interface ConnectorDef {
  id: string;
  name: string;
  /** משפט אחד מנקודת המבט של השליח — מה זה עושה בשבילו */
  description: string;
  category: ConnectorCategory;
  /** החבילה המינימלית שבה החיבור זמין */
  plan: Plan;
  /** האם לספק החיצוני יש עלות משלו (מעבר למנוי) */
  externalCost: boolean;
  /** מה צריך כדי להפעיל */
  needs: 'nothing' | 'google' | 'account';
  /** שדות הגדרה שהלקוח ממלא (מפתחות API וכו') */
  fields?: { key: string; label: string; secret?: boolean }[];
}

export const CONNECTORS: readonly ConnectorDef[] = [
  { id: 'hebcal', name: 'לוח שנה עברי', category: 'calendar', plan: 'free', externalCost: false, needs: 'nothing',
    description: 'חגים, ראשי חודשים ופרשת השבוע במסך היום ובלוח האירועים.' },
  { id: 'wa-link', name: 'WhatsApp מהטלפון', category: 'messages', plan: 'free', externalCost: false, needs: 'nothing',
    description: 'לחיצה פותחת WhatsApp עם הודעה מוכנה, והשליחה נעשית מהטלפון שלך.' },
  { id: 'google-calendar', name: 'יומן Google', category: 'calendar', plan: 'free', externalCost: false, needs: 'google',
    description: 'ימי הולדת, יארצייטים ואירועים מופיעים ביומן שלך, בתאריך העברי הנכון בכל שנה.' },
  { id: 'google-contacts', name: 'אנשי קשר של Google', category: 'data', plan: 'free', externalCost: false, needs: 'google',
    description: 'ייבוא אנשי קשר מהטלפון, ועדכון אוטומטי כשמספר משתנה.' },
  { id: 'gmail', name: 'Gmail', category: 'messages', plan: 'free', externalCost: false, needs: 'google',
    description: 'שליחת מיילים אישיים מהכתובת שלך, ותיעוד אוטומטי בכרטיס המשפחה.' },
  { id: 'sheets', name: 'Google Sheets', category: 'data', plan: 'free', externalCost: false, needs: 'google',
    description: 'ייבוא וייצוא רשימות לגיליון, לשיתוף עם צוות או גבאי.' },

  { id: 'wa-cloud', name: 'WhatsApp עסקי', category: 'messages', plan: 'pro', externalCost: true, needs: 'account',
    description: 'שליחה וקבלה מתוך המערכת, הודעות מתוזמנות ותשובות שנשמרות בכרטיס.',
    fields: [{ key: 'phoneNumberId', label: 'מזהה מספר' }, { key: 'token', label: 'אסימון גישה', secret: true }] },
  { id: 'sms', name: 'SMS', category: 'messages', plan: 'pro', externalCost: true, needs: 'account',
    description: 'הודעות SMS לכל הקהילה או לקבוצה, דרך ספק ישראלי.',
    fields: [{ key: 'provider', label: 'ספק' }, { key: 'apiKey', label: 'מפתח', secret: true }] },
  { id: 'nedarim', name: 'נדרים פלוס', category: 'payments', plan: 'pro', externalCost: true, needs: 'account',
    description: 'תרומות שנכנסות בנדרים פלוס נרשמות לבד בכרטיס התורם.',
    fields: [{ key: 'mosadId', label: 'מספר מוסד' }, { key: 'apiPassword', label: 'סיסמת API', secret: true }] },
  { id: 'cardcom', name: 'קארדקום', category: 'payments', plan: 'pro', externalCost: true, needs: 'account',
    description: 'דף תרומה מאובטח בכרטיס אשראי, עם רישום אוטומטי במערכת.',
    fields: [{ key: 'terminal', label: 'מספר מסוף' }, { key: 'apiName', label: 'שם משתמש API', secret: true }] },
  { id: 'receipts', name: 'קבלות סעיף 46', category: 'payments', plan: 'pro', externalCost: true, needs: 'account',
    description: 'קבלה נשלחת לתורם אוטומטית אחרי כל תרומה.',
    fields: [{ key: 'provider', label: 'ספק (חשבונית ירוקה / iCount)' }, { key: 'apiKey', label: 'מפתח', secret: true }] },
];

export interface ConnectorState {
  enabled: boolean;
  config?: Record<string, string>;
  updatedAt?: number;
}

export type ConnectorSettings = Record<string, ConnectorState>;

/** חינמי ובלי צורך בחשבון חיצוני → פעיל מעצמו */
export function enabledByDefault(def: ConnectorDef): boolean {
  return def.plan === 'free' && def.needs === 'nothing';
}

export function getPlan(settings: AppSettings | undefined): Plan {
  return settings?.plan === 'pro' ? 'pro' : 'free';
}

export function connectorState(settings: AppSettings | undefined, id: string): ConnectorState {
  const def = CONNECTORS.find((c) => c.id === id);
  const saved = (settings?.connectors as ConnectorSettings | undefined)?.[id];
  if (saved) return saved;
  return { enabled: def ? enabledByDefault(def) : false };
}

/** האם החיבור באמת פעיל: מופעל + זמין בחבילה הנוכחית */
export function isConnectorActive(settings: AppSettings | undefined, id: string): boolean {
  const def = CONNECTORS.find((c) => c.id === id);
  if (!def) return false;
  if (def.plan === 'pro' && getPlan(settings) !== 'pro') return false;
  return connectorState(settings, id).enabled;
}

/** מחזיר אובייקט connectors חדש להגדרות (immutable) */
export function setConnector(settings: AppSettings | undefined, id: string, patch: Partial<ConnectorState>): ConnectorSettings {
  const all = { ...((settings?.connectors as ConnectorSettings | undefined) ?? {}) };
  all[id] = { ...connectorState(settings, id), ...patch, updatedAt: Date.now() };
  return all;
}
