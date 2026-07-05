/**
 * טיפוסי הנתונים של «השליחות שלי».
 * מעוגן בפורמט הקיים של community_data_final.json — תואם לאחור במלואו:
 * כל השדות החדשים (id, deletedAt) הם תוספות שהקוד הישן מתעלם מהן.
 */

/** מפתח מיוחד למשפחות ללא כתובת */
export const NO_ADDRESS_KEY = '__NO_ADDRESS__';
export const BOARDS_KEY = '__BOARDS__';
export const SETTINGS_KEY = '__SETTINGS__';
export const META_KEY = 'meta';

export const SPECIAL_KEYS: readonly string[] = [BOARDS_KEY, SETTINGS_KEY, META_KEY];

export interface InteractionLog {
  date?: string;
  type?: string;
  text?: string;
  member?: string;
  [k: string]: unknown;
}

export interface Donation {
  date?: string;
  amount?: number;
  campaign?: string;
  member?: string;
  [k: string]: unknown;
}

export interface Task {
  text?: string;
  done?: boolean;
  due?: string;
  member?: string;
  [k: string]: unknown;
}

export interface Milestone {
  type?: string;
  hebDate?: string;
  gregDate?: string;
  recurring?: boolean;
  [k: string]: unknown;
}

export interface Child {
  name?: string;
  phone?: string;
  [k: string]: unknown;
}

/** דירה/משפחה — הישות המרכזית */
export interface Apartment {
  /** מזהה יציב — חדש; דירות ישנות מזוהות לפי name_num עד המיגרציה */
  id?: string;
  name?: string;
  num?: string;
  father?: string;
  mother?: string;
  fatherPhone?: string;
  motherPhone?: string;
  fatherEmail?: string;
  motherEmail?: string;
  fatherStyle?: string;
  motherStyle?: string;
  phones?: string;
  style?: string;
  notes?: string;
  tags?: string[];
  boards?: Record<string, unknown>;
  childrenList?: Child[];
  interactions?: InteractionLog[];
  donations?: Donation[];
  tasks?: Task[];
  milestones?: Milestone[];
  customData?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  lifecycleEvents?: unknown[];
  pledges?: unknown[];
  splits?: unknown[];
  linkedFrom?: string;
  updatedAt?: number;
  /** tombstone — דירה מחוקה נשארת ברשומה כדי שהמחיקה תנצח בסנכרון */
  deletedAt?: number;
  [k: string]: unknown;
}

export interface BuildingInfo {
  code?: string;
  rep?: string;
  notes?: string;
  coords?: [number, number] | null;
  category?: string;
  subCategory?: string;
  units?: unknown;
  updatedAt?: number;
  _coordSource?: string;
  [k: string]: unknown;
}

export interface BuildingEntry {
  info: BuildingInfo;
  apts: Apartment[];
}

export interface Board {
  id: string;
  name: string;
  columns: string[];
  archived?: boolean;
  updatedAt?: number;
  [k: string]: unknown;
}

export interface Meta {
  lastModified: number;
  [k: string]: unknown;
}

export interface AppSettings {
  styles?: string[];
  tags?: string[];
  themeColor?: string;
  homeLocation?: { coords?: [number, number] };
  center?: [number, number];
  updatedAt?: number;
  [k: string]: unknown;
}

/**
 * מסד הנתונים המלא — אובייקט שטוח שבו רוב המפתחות הם כתובות בניינים,
 * לצד מפתחות מיוחדים. זהו בדיוק פורמט הקובץ ב-Drive.
 */
export interface Db {
  meta?: Meta;
  __BOARDS__?: Board[];
  __SETTINGS__?: AppSettings;
  [address: string]: BuildingEntry | Board[] | AppSettings | Meta | undefined;
}

/** האם המפתח הוא בניין (ולא מפתח מיוחד) */
export function isBuildingKey(key: string): boolean {
  return !SPECIAL_KEYS.includes(key);
}

export function getBuilding(db: Db, key: string): BuildingEntry | undefined {
  if (!isBuildingKey(key)) return undefined;
  const v = db[key];
  if (v && typeof v === 'object' && 'apts' in v) return v as BuildingEntry;
  return undefined;
}

export function buildingKeys(db: Db): string[] {
  return Object.keys(db).filter((k) => isBuildingKey(k) && getBuilding(db, k));
}
