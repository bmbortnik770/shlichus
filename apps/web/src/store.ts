import { create } from 'zustand';
import { type Db, type InteractionLog, type SyncStatus, DriveBackend, getBuilding } from '@shlichus/core';
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
  /** רישום קשר עם משפחה — מיידי בממשק, השמירה רצה ברקע; מחזיר פונקציית ביטול */
  logContact: (bldg: string, idx: number, type: ContactType) => () => void;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const useStore = create<State>((set, get) => {
  /** שמירה מקומית מיידית + סנכרון לענן ברקע */
  const persist = async () => {
    const db = get().db;
    if (!db) return;
    set({ db: { ...db } });
    if (!hasValidSession()) {
      set({ sync: 'auth-needed' });
      await backend.saveLocal(db); // בלי חיבור — שומרים במכשיר בלבד, בלי לחכות לטוקן
      return;
    }
    set({ sync: 'syncing', syncError: null });
    try {
      const final = await backend.save(db);
      set({ db: { ...final }, sync: 'synced' });
    } catch (e) {
      const auth = e instanceof Error && e.name === 'AuthRequiredError';
      set({ sync: auth ? 'auth-needed' : 'error', syncError: auth ? null : 'נשמר במכשיר. הסנכרון לענן יושלם בחיבור הבא.' });
    }
  };

  const pull = async () => {
    set({ sync: 'syncing', syncError: null });
    try {
      const merged = await backend.pull(get().db);
      if (merged) set({ db: merged, status: 'ready' });
      set({ sync: 'synced' });
    } catch (e) {
      const auth = e instanceof Error && e.name === 'AuthRequiredError';
      set({ sync: auth ? 'auth-needed' : 'error', syncError: auth ? null : 'לא הצלחנו להתחבר לענן. מציג את הנתונים שבמכשיר.' });
    }
  };

  return {
    db: null,
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

    updateSettings: async (patch) => {
      const db = get().db;
      if (!db) return;
      db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), ...patch, updatedAt: Date.now() };
      await persist();
    },
  };
});
