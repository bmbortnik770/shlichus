import { create } from 'zustand';
import { type Db, type InteractionLog, type SyncStatus, DriveBackend, aptIdentity, getBuilding, mergeDb } from '@shlichus/core';
import { browserTokens, hasValidSession, interactiveLogin } from './auth';

const backend = new DriveBackend(browserTokens);

/** סוגי קשר — אותן תוויות כמו בישן, כדי שהניקוד יזהה אותן */
export const CONTACT_TYPES = {
  phone: 'שיחה',
  whatsapp: 'WhatsApp',
  visit: 'ביקור',
} as const;
export type ContactType = keyof typeof CONTACT_TYPES;

interface State {
  db: Db | null;
  status: 'loading' | 'ready' | 'empty';
  sync: SyncStatus;
  syncError: string | null;
  load: () => Promise<void>;
  login: () => Promise<void>;
  /** סנכרון יזום: משיכה מהענן + עדכוני שטח */
  syncNow: (manual?: boolean) => Promise<void>;
  logout: () => void;
  lastSync: number | null;
  /** מצב מקומי — עבודה בלי חשבון גוגל (הנתונים נשמרים רק במכשיר) */
  startLocal: () => void;
  /** רישום קשר עם משפחה — מיידי בממשק, השמירה רצה ברקע; מחזיר פונקציית ביטול */
  logContact: (bldg: string, idx: number, type: ContactType) => () => void;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  /**
   * שינוי כלשהו בנתונים: צילום מצב, החלה, שמירה ברקע. מחזיר ביטול שמחזיר
   * בדיוק את המצב הקודם (משמש לתיקוני מפה גורפים).
   */
  mutate: (fn: (db: Db) => void) => () => void;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** מאזינים להודעה "יושמו N עדכוני שטח" */
const fieldListeners = new Set<(n: number) => void>();
export const onFieldUpdates = (fn: (n: number) => void) => { fieldListeners.add(fn); return () => { fieldListeners.delete(fn); }; };

export const useStore = create<State>((set, get) => {
  /**
   * שמירות רצות אחת-אחת. rev עולה בכל שינוי; אם השתנה משהו בזמן שמירה/משיכה —
   * ממזגים את השינוי עם התוצאה (מול העותק שנשלח) ושומרים שוב, כך ששום שינוי לא הולך לאיבוד.
   */
  let rev = 0;
  let inFlight = false;
  let again = false;
  /** שמירה מקומית מיידית + סנכרון לענן ברקע */
  const persist = async () => {
    const db = get().db;
    if (!db) return;
    rev++;
    set({ db: { ...db } });
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      do { again = false; await persistOnce(); } while (again);
    } finally { inFlight = false; }
  };
  const persistOnce = async () => {
    const db = get().db;
    if (!db) return;
    if (!hasValidSession()) {
      set({ sync: 'auth-needed' });
      await backend.saveLocal(db); // בלי חיבור — שומרים במכשיר בלבד, בלי לחכות לטוקן
      return;
    }
    set({ sync: 'syncing', syncError: null });
    const startRev = rev;
    const sent = structuredClone(db);
    try {
      const final = await backend.save(db);
      const cur = get().db;
      if (rev !== startRev && cur) { set({ db: mergeDb(cur, final, sent), sync: 'synced' }); again = true; }
      else set({ db: { ...final }, sync: 'synced' });
    } catch (e) {
      const auth = e instanceof Error && e.name === 'AuthRequiredError';
      set({ sync: auth ? 'auth-needed' : 'error', syncError: auth ? null : 'נשמר במכשיר. הסנכרון לענן יושלם בחיבור הבא.' });
    }
  };

  const pull = async () => {
    set({ sync: 'syncing', syncError: null });
    try {
      const startRev = rev;
      const before = get().db;
      const sent = before ? structuredClone(before) : null;
      const merged = await backend.pull(before);
      const cur = get().db;
      if (merged && rev !== startRev && cur && sent) { set({ db: mergeDb(cur, merged, sent), status: 'ready' }); void persist(); }
      else if (merged) set({ db: merged, status: 'ready' });
      set({ sync: 'synced', lastSync: Date.now() });
      await fieldUpdates();
    } catch (e) {
      const auth = e instanceof Error && e.name === 'AuthRequiredError';
      set({ sync: auth ? 'auth-needed' : 'error', syncError: auth ? null : 'לא הצלחנו להתחבר לענן. מציג את הנתונים שבמכשיר.' });
    }
  };

  /** עדכונים מאפליקציית השטח — מוחלים, נשמרים לענן, ורק אז הקבצים מנוקים */
  const fieldUpdates = async () => {
    const db = get().db;
    if (!db || !hasValidSession()) return;
    try {
      const { applied, commit } = await backend.fieldUpdates(db);
      if (!applied) { await commit(); return; }
      await persist();
      if (get().sync === 'synced') await commit();
      fieldListeners.forEach((fn) => fn(applied));
    } catch { /* ננסה בסבב הבא */ }
  };

  return {
    db: null,
    lastSync: null,
    syncNow: async () => { if (hasValidSession()) await pull(); else set({ sync: 'auth-needed' }); },
    logout: () => {
      try { localStorage.removeItem('gdrive_session'); } catch { /* */ }
      set({ sync: 'auth-needed' });
    },
    startLocal: () => set({ db: { meta: { lastModified: Date.now() } }, status: 'ready', sync: 'offline' }),
    status: 'loading',
    sync: 'offline',
    syncError: null,

    load: async () => {
      const local = await backend.loadLocal();
      set({ db: local, status: local ? 'ready' : 'empty' });
      if (hasValidSession()) await pull();
      else set({ sync: 'auth-needed' });
    },

    login: async () => {
      const token = await interactiveLogin();
      if (token) await pull();
    },

    logContact: (bldg, idx, type) => {
      const db = get().db;
      const entry = db ? getBuilding(db, bldg) : undefined;
      const apt = entry?.apts[idx];
      if (!entry || !apt) return () => {};
      const log: InteractionLog = {
        date: todayIso(), type: CONTACT_TYPES[type], interactionType: type, channel: type,
        text: 'נרשם ממסך היום', member: 'family', source: 'web', id: `log_${Date.now()}`,
      };
      entry.apts[idx] = { ...apt, interactions: [log, ...(apt.interactions ?? [])], updatedAt: Date.now() };
      void persist();
      return () => {
        const e = getBuilding(get().db ?? {}, bldg);
        const cur = e?.apts[idx];
        if (!e || !cur) return;
        e.apts[idx] = { ...cur, interactions: (cur.interactions ?? []).filter((l) => l.id !== log.id), updatedAt: Date.now() };
        void persist();
      };
    },

    mutate: (fn) => {
      const db = get().db;
      if (!db) return () => {};
      const before = structuredClone(db);
      fn(db);
      void persist();
      return () => {
        const cur = get().db ?? {};
        const restored = structuredClone(before);
        const now = Date.now();
        // הביטול עצמו הוא שינוי חדש: כל בניין שהשתנה מקבל חותמות עדכניות כדי לנצח במיזוג,
        // ודירות שנוספו לו בשינוי נשמרות כמחוקות (אחרת עותק הענן היה מחזיר אותן)
        for (const k of Object.keys(cur)) {
          const now_ = getBuilding(cur, k);
          if (!now_) continue;
          const was = getBuilding(restored, k);
          if (!was) {
            restored[k] = { info: { deletedAt: now, updatedAt: now }, apts: [] };
            continue;
          }
          if (JSON.stringify(was) === JSON.stringify(now_)) continue;
          const had = new Set(was.apts.map(aptIdentity));
          for (const a of now_.apts) if (!had.has(aptIdentity(a))) was.apts.push({ ...a, deletedAt: now, updatedAt: now });
          was.apts = was.apts.map((a) => ({ ...a, updatedAt: now }));
          was.info = { ...was.info, updatedAt: now };
        }
        set({ db: restored });
        void persist();
      };
    },

    updateSettings: async (patch) => {
      const db = get().db;
      if (!db) return;
      db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), ...patch, updatedAt: Date.now() };
      await persist();
    },
  };
});
