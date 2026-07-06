import { create } from 'zustand';
import {
  type Apartment,
  type Db,
  DriveSync,
  NO_ADDRESS_KEY,
  buildingKeys,
  getBuilding,
  liveApts,
  loadLocal,
  migrateFromLocalStorage,
  saveLocal,
  softDeleteApt,
} from '@shlichus/core';
import { browserTokens, hasValidSession, interactiveLogin } from './auth';
import { mergeDb } from '@shlichus/core';

export type SyncState = 'offline' | 'syncing' | 'synced' | 'auth-needed' | 'error';

interface CrmState {
  db: Db | null;
  status: 'loading' | 'ready' | 'empty';
  sync: SyncState;
  syncError: string | null;
  load: () => Promise<void>;
  pullFromCloud: () => Promise<void>;
  login: () => Promise<void>;
  updateApt: (bldg: string, idx: number, patch: Partial<Apartment>) => Promise<void>;
  updateGeneralTask: (taskIdx: number, done: boolean) => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  /** הוספת משפחה; מחזירה את המפתח והאינדקס לפתיחת הכרטיס */
  addApt: (bldg: string) => Promise<{ bldg: string; idx: number } | null>;
  /** מחיקה רכה — tombstone; המחיקה שורדת סנכרון מכל מכשיר */
  deleteApt: (bldg: string, idx: number) => Promise<void>;
  updateBuildingInfo: (bldg: string, patch: Record<string, unknown>) => Promise<void>;
  updateBoards: (boards: Db['__BOARDS__']) => Promise<void>;
  /** פיצול כרטיס — יוצר כרטיס נפרד לבן משפחה, עם קישור דו-כיווני כמו בישן */
  splitFamily: (bldg: string, idx: number, memberName: string) => Promise<{ bldg: string; idx: number } | null>;
  /** ייבוא משפחות; מחזיר {imported, skipped} — כפילות לפי כתובת+שם+דירה מדולגת */
  importFamilies: (rows: { name: string; bldg: string; num: string; phone: string; style: string; tags: string[] }[]) => Promise<{ imported: number; skipped: number }>;
}

const drive = new DriveSync({ tokenProvider: browserTokens });

export const useCrm = create<CrmState>((set, get) => {
  /** שמירה מקומית + דחיפה בטוחה לענן — משותף לכל פעולות הכתיבה */
  const persistAndPush = async () => {
    const db = get().db;
    if (!db) return;
    db.meta = { ...(db.meta ?? { lastModified: 0 }), lastModified: Date.now() };
    const next = { ...db };
    set({ db: next });
    await saveLocal(next);

    if (!hasValidSession()) {
      set({ sync: 'auth-needed' });
      return;
    }
    set({ sync: 'syncing', syncError: null });
    try {
      if (!drive.fileId) {
        const pulled = await drive.pull();
        if (!pulled) { set({ sync: 'offline' }); return; } // אין קובץ בענן — v2 לא יוצרת אחד
      }
      // pull-merge-push עם בדיקת revision: שום צד לא נדרס
      const final = await drive.safeSave(get().db!);
      set({ db: { ...final }, sync: 'synced' });
      await saveLocal(final);
    } catch (e) {
      const authIssue = e instanceof Error && e.name === 'AuthRequiredError';
      set({
        sync: authIssue ? 'auth-needed' : 'error',
        syncError: authIssue ? null : 'השינוי נשמר מקומית; הסנכרון לענן ייעשה בחיבור הבא',
      });
    }
  };

  return {
  db: null,
  status: 'loading',
  sync: 'offline',
  syncError: null,

  load: async () => {
    // קודם IndexedDB; אם ריק — מיגרציה שקטה מ-localStorage של המערכת הישנה
    const local = (await loadLocal()) ?? (await migrateFromLocalStorage());
    set({ db: local, status: local ? 'ready' : 'empty' });
    // אם יש session תקף (למשל מהמערכת הישנה) — משוך מהענן ברקע
    if (hasValidSession()) await get().pullFromCloud();
    else set({ sync: 'auth-needed' });
  },

  pullFromCloud: async () => {
    set({ sync: 'syncing', syncError: null });
    try {
      const remote = await drive.pull();
      if (!remote) {
        // אין קובץ בענן — מצב מקומי בלבד; לא יוצרים קובץ מגרסת v2 הקריאה-בלבד
        set({ sync: 'synced' });
        return;
      }
      const local = get().db;
      const merged = local ? mergeDb(local, remote.db) : remote.db;
      await saveLocal(merged);
      set({ db: merged, status: 'ready', sync: 'synced' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const authIssue = e instanceof Error && e.name === 'AuthRequiredError';
      set({ sync: authIssue ? 'auth-needed' : 'error', syncError: authIssue ? null : msg });
    }
  },

  login: async () => {
    const token = await interactiveLogin();
    if (token) await get().pullFromCloud();
  },

  updateApt: async (bldg, idx, patch) => {
    const db = get().db;
    if (!db) return;
    const entry = getBuilding(db, bldg);
    const apt = entry?.apts[idx];
    if (!entry || !apt) return;
    entry.apts[idx] = { ...apt, ...patch, updatedAt: Date.now() };
    await persistAndPush();
  },

  updateSettings: async (patch) => {
    const db = get().db;
    if (!db) return;
    db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), ...patch, updatedAt: Date.now() };
    await persistAndPush();
  },

  addApt: async (bldg) => {
    const db = get().db;
    if (!db) return null;
    const key = bldg || NO_ADDRESS_KEY;
    if (!getBuilding(db, key)) {
      (db as Record<string, unknown>)[key] = { info: { code: '', rep: '', notes: '', coords: null }, apts: [] };
    }
    const entry = getBuilding(db, key)!;
    const styles = (db.__SETTINGS__?.styles ?? []) as string[];
    entry.apts.push({
      id: `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: '', num: '', style: styles[0] ?? '',
      tags: [], boards: {}, childrenList: [], interactions: [], donations: [], tasks: [],
      customFields: {}, updatedAt: Date.now(),
    });
    await persistAndPush();
    return { bldg: key, idx: entry.apts.length - 1 };
  },

  deleteApt: async (bldg, idx) => {
    const db = get().db;
    const apt = getBuilding(db ?? {}, bldg)?.apts[idx];
    if (!apt) return;
    softDeleteApt(apt);
    await persistAndPush();
  },

  splitFamily: async (bldg, idx, memberName) => {
    const db = get().db;
    const orig = getBuilding(db ?? {}, bldg)?.apts[idx];
    if (!db || !orig) return null;
    const splitDate = new Date().toISOString().slice(0, 10);
    if (!getBuilding(db, NO_ADDRESS_KEY)) {
      (db as Record<string, unknown>)[NO_ADDRESS_KEY] = { info: { code: '', rep: '', notes: '', coords: null }, apts: [] };
    }
    const target = getBuilding(db, NO_ADDRESS_KEY)!;
    // אותו מבנה כמו confirmSplitMember בישן
    target.apts.push({
      id: `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: memberName,
      style: orig.style ?? '',
      tags: [...(orig.tags ?? [])],
      childrenList: [], boards: {}, customData: {}, customFields: {}, milestones: [],
      interactions: [{ date: splitDate, type: 'פיצול כרטיס', text: `נפצל מכרטיס משפחת ${orig.name ?? ''}`, member: 'family' }],
      donations: [], tasks: [],
      splitDate, linkedFrom: `${bldg}|${idx}`,
      updatedAt: Date.now(),
    });
    const newIdx = target.apts.length - 1;
    if (!orig.splits) orig.splits = [];
    (orig.splits as unknown[]).push({ memberName, splitDate, linkedTo: `${NO_ADDRESS_KEY}|${newIdx}` });
    orig.updatedAt = Date.now();
    await persistAndPush();
    return { bldg: NO_ADDRESS_KEY, idx: newIdx };
  },

  importFamilies: async (rows) => {
    const db = get().db;
    if (!db) return { imported: 0, skipped: 0 };
    let imported = 0, skipped = 0;
    for (const r of rows) {
      const key = r.bldg.trim() || NO_ADDRESS_KEY;
      if (!getBuilding(db, key)) {
        (db as Record<string, unknown>)[key] = { info: { code: '', rep: '', notes: '', coords: null }, apts: [] };
      }
      const entry = getBuilding(db, key)!;
      const exists = entry.apts.some(
        (a) => !a.deletedAt && (a.name ?? '') === r.name.trim() && (a.num ?? '') === r.num.trim()
      );
      if (exists) { skipped++; continue; }
      entry.apts.push({
        id: `apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: r.name.trim(), num: r.num.trim(),
        fatherPhone: r.phone.trim(), style: r.style.trim(),
        tags: r.tags, boards: {}, childrenList: [], interactions: [], donations: [], tasks: [],
        customFields: {}, updatedAt: Date.now(),
      });
      imported++;
    }
    if (imported > 0) await persistAndPush();
    return { imported, skipped };
  },

  updateBoards: async (boards) => {
    const db = get().db;
    if (!db) return;
    db.__BOARDS__ = boards;
    await persistAndPush();
  },

  updateBuildingInfo: async (bldg, patch) => {
    const db = get().db;
    const entry = getBuilding(db ?? {}, bldg);
    if (!entry) return;
    entry.info = { ...entry.info, ...patch, updatedAt: Date.now() };
    await persistAndPush();
  },

  updateGeneralTask: async (taskIdx, done) => {
    const db = get().db;
    if (!db?.meta) return;
    const tasks = (db.meta.generalTasks ?? []) as { done?: boolean }[];
    if (!tasks[taskIdx]) return;
    tasks[taskIdx] = { ...tasks[taskIdx], done };
    db.meta.generalTasks = [...tasks];
    await persistAndPush();
  },
  };
});

export function familyCount(db: Db): number {
  return buildingKeys(db).reduce((sum, k) => sum + liveApts(getBuilding(db, k)?.apts).length, 0);
}
