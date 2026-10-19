/**
 * טריטוריה וקטגוריות בניינים — תואם למבנה של המערכת הקיימת:
 * appSettings.territory = { polygon: [[lng,lat]...], displayMode, categories: [...] }
 * info.category = מזהה קטגוריה.
 */
import type { Db } from './types.js';

export interface BuildingCategory {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  isDefault?: boolean;
  hasCard?: boolean;
  subCategories?: { id: string; name: string; color: string }[];
  defaultFields?: unknown[];
}

export interface InstitutionField { id: string; label: string; type: 'text' | 'phone' | 'textarea' | 'url' }

/**
 * כרטיס מוסד לבניין שאינו מגורים — אותם שדות ותת-סוגים כמו tmCategories בישן.
 * נשמר ב-info.institutionName, info.institutionData {שדה: ערך}, info.subCategoryId, info.notes.
 */
export const INSTITUTION_FIELDS: Record<string, InstitutionField[]> = {
  synagogue: [{ id: 'contactName', label: 'שם הרב / איש קשר', type: 'text' }, { id: 'phone', label: 'טלפון', type: 'phone' }, { id: 'prayerTimes', label: 'זמני תפילה', type: 'textarea' }, { id: 'hours', label: 'שעות פעילות', type: 'text' }],
  education: [{ id: 'contactName', label: 'שם המנהל / איש קשר', type: 'text' }, { id: 'phone', label: 'טלפון', type: 'phone' }, { id: 'ageGroup', label: 'גילאים', type: 'text' }, { id: 'hours', label: 'שעות פעילות', type: 'text' }],
  medical: [{ id: 'contactName', label: 'שם הרופא / איש קשר', type: 'text' }, { id: 'phone', label: 'טלפון', type: 'phone' }, { id: 'hours', label: 'שעות קבלה', type: 'text' }, { id: 'specialty', label: 'התמחות', type: 'text' }],
  business: [{ id: 'contactName', label: 'שם בעל העסק / איש קשר', type: 'text' }, { id: 'phone', label: 'טלפון', type: 'phone' }, { id: 'hours', label: 'שעות פתיחה', type: 'text' }, { id: 'website', label: 'אתר אינטרנט', type: 'url' }],
  offices: [{ id: 'contactName', label: 'איש קשר', type: 'text' }, { id: 'phone', label: 'טלפון', type: 'phone' }, { id: 'hours', label: 'שעות פעילות', type: 'text' }, { id: 'website', label: 'אתר', type: 'url' }],
};
export const SUB_CATEGORIES: Record<string, { id: string; name: string }[]> = {
  residential: [{ id: 'residential_apt', name: 'דירת מגורים' }, { id: 'residential_house', name: 'בית פרטי' }, { id: 'residential_bldg', name: 'בניין מגורים' }],
  synagogue: [{ id: 'synagogue_chabad', name: 'בית חב"ד' }, { id: 'synagogue_general', name: 'בית כנסת' }, { id: 'synagogue_institution', name: 'מוסד דתי' }],
  education: [{ id: 'education_kindergarten', name: 'גן ילדים' }, { id: 'education_school', name: 'בית ספר' }, { id: 'education_college', name: 'מכללה / אוניברסיטה' }, { id: 'education_other', name: 'מוסד חינוכי אחר' }],
  medical: [{ id: 'medical_clinic', name: 'קליניקה / מרפאה' }, { id: 'medical_pharmacy', name: 'בית מרקחת' }, { id: 'medical_hospital', name: 'בית חולים' }, { id: 'medical_other', name: 'שירות רפואי אחר' }],
  business: [{ id: 'business_store', name: 'חנות' }, { id: 'business_restaurant', name: 'מסעדה / בית קפה' }, { id: 'business_office', name: 'משרד / עסק' }, { id: 'business_other', name: 'עסק אחר' }],
  offices: [{ id: 'offices_govt', name: 'מוסד ממשלתי' }, { id: 'offices_org', name: 'עמותה / ארגון' }, { id: 'offices_general', name: 'משרד כללי' }],
};

/** 7 קטגוריות ברירת המחדל — אותם מזהים וצבעים כמו tmCategories בישן */
export const DEFAULT_CATEGORIES: BuildingCategory[] = [
  { id: 'residential', name: 'מגורים', color: '#3b82f6', emoji: '🏠', isDefault: true, hasCard: true },
  { id: 'synagogue', name: 'דת ובית כנסת', color: '#8b5cf6', emoji: '🕍', hasCard: true },
  { id: 'education', name: 'חינוך', color: '#10b981', emoji: '🏫', hasCard: true },
  { id: 'medical', name: 'בריאות', color: '#ef4444', emoji: '🏥', hasCard: true },
  { id: 'business', name: 'עסקים', color: '#f59e0b', emoji: '🏪', hasCard: true },
  { id: 'offices', name: 'משרדים ומוסדות', color: '#6366f1', emoji: '🏢', hasCard: true },
  { id: 'irrelevant', name: 'לא רלוונטי', color: '#94a3b8', emoji: '🚫', hasCard: false },
];

interface TerritorySettings {
  polygon?: [number, number][];
  displayMode?: string;
  categories?: BuildingCategory[];
  [k: string]: unknown;
}

export function getTerritory(db: Db): TerritorySettings {
  return ((db.__SETTINGS__ as Record<string, unknown> | undefined)?.territory ?? {}) as TerritorySettings;
}

/**
 * קטגוריות בפועל: ברירות מחדל ממוזגות עם השמורות (אותה לוגיקה כמו הישן),
 * כולל תיקון כפל isDefault.
 */
export function getCategories(db: Db): BuildingCategory[] {
  const saved = getTerritory(db).categories ?? [];
  const merged = DEFAULT_CATEGORIES.map((def) => {
    const stored = saved.find((s) => s.id === def.id);
    return stored ? { ...def, ...stored } : { ...def };
  });
  for (const s of saved) {
    if (!merged.find((c) => c.id === s.id)) merged.push({ ...s });
  }
  const defaults = merged.filter((c) => c.isDefault);
  if (defaults.length !== 1) {
    const keepId = saved.find((s) => s.isDefault)?.id ?? 'residential';
    merged.forEach((c) => { c.isDefault = c.id === keepId; });
    if (!merged.some((c) => c.isDefault) && merged[0]) merged[0].isDefault = true;
  }
  return merged;
}

export function categoryColor(db: Db, categoryId: string | undefined): string {
  if (!categoryId) return '#94a3b8';
  return getCategories(db).find((c) => c.id === categoryId)?.color ?? '#94a3b8';
}

/**
 * נקודה בתוך פוליגון — ray casting.
 * (בישן היו באגים סביב טבעת לא סגורה — כאן זה עובד גם סגורה וגם פתוחה.)
 */
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [x, y] = point;
  // התעלם מנקודת סגירה כפולה אם קיימת
  const ring =
    polygon.length > 3 &&
    polygon[0]![0] === polygon[polygon.length - 1]![0] &&
    polygon[0]![1] === polygon[polygon.length - 1]![1]
      ? polygon.slice(0, -1)
      : polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
