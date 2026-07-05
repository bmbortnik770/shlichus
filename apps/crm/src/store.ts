import { create } from 'zustand';
import {
  type Db,
  DriveSync,
  buildingKeys,
  getBuilding,
  liveApts,
  loadLocal,
  migrateFromLocalStorage,
  saveLocal,
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
}

const drive = new DriveSync({ tokenProvider: browserTokens });

export const useCrm = create<CrmState>((set, get) => ({
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
}));

export function familyCount(db: Db): number {
  return buildingKeys(db).reduce((sum, k) => sum + liveApts(getBuilding(db, k)?.apts).length, 0);
}
