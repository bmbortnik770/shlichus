import { create } from 'zustand';
import {
  type Db,
  buildingKeys,
  getBuilding,
  liveApts,
  loadLocal,
  migrateFromLocalStorage,
  saveLocal,
} from '@shlichus/core';

interface CrmState {
  db: Db | null;
  status: 'loading' | 'ready' | 'empty';
  load: () => Promise<void>;
  setDb: (db: Db) => Promise<void>;
}

export const useCrm = create<CrmState>((set) => ({
  db: null,
  status: 'loading',
  load: async () => {
    // קודם IndexedDB; אם ריק — מיגרציה שקטה מ-localStorage של המערכת הישנה
    const db = (await loadLocal()) ?? (await migrateFromLocalStorage());
    set({ db, status: db ? 'ready' : 'empty' });
  },
  setDb: async (db) => {
    set({ db });
    await saveLocal(db);
  },
}));

export function familyCount(db: Db): number {
  return buildingKeys(db).reduce((sum, k) => sum + liveApts(getBuilding(db, k)?.apts).length, 0);
}
