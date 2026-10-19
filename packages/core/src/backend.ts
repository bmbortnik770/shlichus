/**
 * שכבת אחסון אחידה — הממשק לא יודע איפה הנתונים יושבים.
 *
 * - DriveBackend (חבילה חינמית): עותק מקומי ב-IndexedDB + קובץ JSON בדרייב של הלקוח.
 * - ServerBackend (חבילת Pro, בהמשך): מסד נתונים בשרת עם ריבוי משתמשים,
 *   ואופציונלית גיבוי לדרייב. יממש את אותו ממשק בדיוק.
 */
import type { Db } from './types.js';
import { DriveSync, type TokenProvider } from './driveSync.js';
import { mergeDb } from './merge.js';
import { cacheGet, cachePut, loadLocal, migrateFromLocalStorage, saveLocal } from './storage.js';

/** הגרסה האחרונה שידוע שהיא בענן — הבסיס למיזוג תלת-כיווני */
const BASE_KEY = 'sync:base';
const getBase = () => cacheGet<Db>(BASE_KEY).catch(() => null);
const setBase = (db: Db) => cachePut(BASE_KEY, db).catch(() => {});
import { applyOutbox, fetchOutbox } from './fieldUpdates.js';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'auth-needed' | 'error';

export interface StorageBackend {
  readonly kind: 'drive' | 'server';
  /** טעינה מהירה מהעותק המקומי (לפני רשת) */
  loadLocal(): Promise<Db | null>;
  /** משיכה מהענן ומיזוג עם המקומי; מחזיר את התוצאה הממוזגת או null אם אין ענן */
  pull(local: Db | null): Promise<Db | null>;
  /** שמירה במכשיר בלבד (כשאין חיבור לענן) */
  saveLocal(db: Db): Promise<void>;
  /** שמירה מקומית + דחיפה בטוחה (מיזוג לפני כתיבה); מחזיר את הגרסה הסופית */
  save(db: Db): Promise<Db>;
}

export class DriveBackend implements StorageBackend {
  readonly kind = 'drive' as const;
  private sync: DriveSync;

  constructor(tokens: TokenProvider, opts: { fetchFn?: typeof fetch } = {}) {
    this.sync = new DriveSync({ tokenProvider: tokens, fetchFn: opts.fetchFn });
  }

  async loadLocal(): Promise<Db | null> {
    return (await loadLocal()) ?? (await migrateFromLocalStorage());
  }

  async pull(local: Db | null): Promise<Db | null> {
    const remote = await this.sync.pull();
    if (!remote) return null;
    const merged = local ? mergeDb(local, remote.db, await getBase()) : remote.db;
    await saveLocal(merged);
    await setBase(remote.db);
    return merged;
  }

  async saveLocal(db: Db): Promise<void> {
    db.meta = { ...(db.meta ?? { lastModified: 0 }), lastModified: Date.now() };
    await saveLocal(db);
  }

  /**
   * עדכונים מאפליקציית השטח: מחיל על db (במקום) ומחזיר כמה יושמו.
   * הקבצים עוברים לסל רק אחרי שהשמירה לענן הצליחה — אחרת עדכון היה הולך לאיבוד.
   */
  async fieldUpdates(db: Db): Promise<{ applied: number; commit: () => Promise<void> }> {
    const files = await fetchOutbox(this.sync);
    if (!files.length) return { applied: 0, commit: async () => {} };
    const { applied, trash } = applyOutbox(db, files);
    return { applied, commit: async () => { for (const id of trash) { try { await this.sync.trash(id); } catch { /* ננסה בסבב הבא */ } } } };
  }

  async save(db: Db): Promise<Db> {
    db.meta = { ...(db.meta ?? { lastModified: 0 }), lastModified: Date.now() };
    await saveLocal(db);
    if (!this.sync.fileId) {
      const pulled = await this.sync.pull();
      // שמירה לפני המשיכה הראשונה: קודם ממזגים עם מה שבענן, אחרת שינויים ממכשיר אחר היו נדרסים
      if (pulled) {
        const base = await getBase();
        const merged = mergeDb(db, pulled.db, base);
        for (const k of Object.keys(db)) if (!(k in merged)) delete db[k];
        Object.assign(db, merged);
        await setBase(pulled.db);
      }
      if (!pulled) {
        // לקוח חדש בלי קובץ בענן — יוצרים אחד
        await this.sync.createFile(db);
        await setBase(db);
        return db;
      }
    }
    const final = await this.sync.safeSave(db, 3, await getBase());
    await saveLocal(final);
    await setBase(final);
    return final;
  }
}
