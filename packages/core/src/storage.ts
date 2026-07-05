/**
 * אחסון מקומי ב-IndexedDB — מחליף את localStorage (תקרת ~5MB) של הישן.
 * ממשק key-value מינימלי בלי תלות חיצונית.
 */
import type { Db } from './types.js';

const DB_NAME = 'shlichus';
const STORE = 'kv';
export const DB_KEY = 'community_data_final';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function op<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await openIdb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = idb.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

export async function loadLocal(): Promise<Db | null> {
  const val = await op<unknown>('readonly', (s) => s.get(DB_KEY) as IDBRequest<unknown>);
  return (val as Db) ?? null;
}

export async function saveLocal(db: Db): Promise<void> {
  await op('readwrite', (s) => s.put(structuredClone(db), DB_KEY));
}

/** מיגרציה חד-פעמית מ-localStorage של המערכת הישנה — לא מוחקת את המקור */
export async function migrateFromLocalStorage(): Promise<Db | null> {
  const existing = await loadLocal();
  if (existing) return existing;
  try {
    const raw = globalThis.localStorage?.getItem(DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Db;
    await saveLocal(parsed);
    return parsed;
  } catch {
    return null;
  }
}
