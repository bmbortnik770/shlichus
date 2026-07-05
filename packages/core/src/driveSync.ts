/**
 * סנכרון Google Drive — הגרסה המתוקנת של שכבת הסנכרון מ-drive.js.
 *
 * תיקונים לעומת הישן:
 * 1. כל תשובת HTTP נבדקת (res.ok) — כשל שמירה לעולם לא מדווח כהצלחה.
 * 2. ‏401/403 → רענון טוקן וניסיון חוזר אחד, ואם נכשל — שגיאה מפורשת.
 * 3. בקרת גרסאות: לפני כתיבה נבדק headRevisionId; אם הקובץ השתנה מאז
 *    המשיכה האחרונה — pull ומיזוג ואז push (אין יותר last-writer-wins עיוור).
 */
import type { Db } from './types.js';
import { mergeDb } from './merge.js';

export interface TokenProvider {
  /** טוקן נוכחי, או null אם אין */
  getToken(): Promise<string | null>;
  /** רענון שקט; מחזיר טוקן חדש או null אם נדרשת התחברות מלאה */
  refresh(): Promise<string | null>;
}

export class AuthRequiredError extends Error {
  constructor() { super('נדרשת התחברות מחדש ל-Google'); this.name = 'AuthRequiredError'; }
}
export class DriveHttpError extends Error {
  constructor(public status: number, context: string) {
    super(`Drive ${context} failed: HTTP ${status}`);
    this.name = 'DriveHttpError';
  }
}
export class ConflictError extends Error {
  constructor() { super('הקובץ בענן השתנה מאז המשיכה האחרונה'); this.name = 'ConflictError'; }
}

export interface DriveSyncOptions {
  fileName?: string;
  folderName?: string;
  fetchFn?: typeof fetch;
  tokenProvider: TokenProvider;
}

export interface PullResult {
  db: Db;
  fileId: string;
  revisionId: string;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveSync {
  private fileName: string;
  private folderName: string;
  private fetchFn: typeof fetch;
  private tokens: TokenProvider;

  /** ה-revision שנמשך לאחרונה — הבסיס לבדיקת קונפליקטים בכתיבה */
  baseRevisionId: string | null = null;
  fileId: string | null = null;
  folderId: string | null = null;

  constructor(opts: DriveSyncOptions) {
    this.fileName = opts.fileName ?? 'community_data_final.json';
    this.folderName = opts.folderName ?? 'השליחות שלי';
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.tokens = opts.tokenProvider;
  }

  /** קריאה עם אימות: בודקת res.ok, מרעננת טוקן פעם אחת על 401/403 */
  private async request(url: string, init: RequestInit = {}, context = 'request'): Promise<Response> {
    let token = await this.tokens.getToken();
    if (!token) token = await this.tokens.refresh();
    if (!token) throw new AuthRequiredError();

    const doFetch = (t: string) =>
      this.fetchFn(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });

    let res = await doFetch(token);
    if (res.status === 401 || res.status === 403) {
      const fresh = await this.tokens.refresh();
      if (!fresh) throw new AuthRequiredError();
      res = await doFetch(fresh);
      if (res.status === 401 || res.status === 403) throw new AuthRequiredError();
    }
    if (!res.ok) throw new DriveHttpError(res.status, context);
    return res;
  }

  private async ensureFolder(): Promise<string | null> {
    if (this.folderId) return this.folderId;
    const q = encodeURIComponent(
      `name='${this.folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const res = await this.request(`${DRIVE}/files?q=${q}&spaces=drive`, {}, 'find folder');
    const list = (await res.json()) as { files?: { id: string }[] };
    this.folderId = list.files?.[0]?.id ?? null;
    return this.folderId;
  }

  private async findFile(): Promise<{ id: string; headRevisionId: string } | null> {
    const folderId = await this.ensureFolder();
    const parentQ = folderId ? ` and '${folderId}' in parents` : '';
    const q = encodeURIComponent(`name='${this.fileName}' and trashed=false${parentQ}`);
    const res = await this.request(
      `${DRIVE}/files?q=${q}&spaces=drive&fields=files(id,headRevisionId)`,
      {},
      'find file'
    );
    const list = (await res.json()) as { files?: { id: string; headRevisionId: string }[] };
    return list.files?.[0] ?? null;
  }

  private async headRevision(fileId: string): Promise<string> {
    const res = await this.request(`${DRIVE}/files/${fileId}?fields=headRevisionId`, {}, 'head revision');
    const meta = (await res.json()) as { headRevisionId: string };
    return meta.headRevisionId;
  }

  /** משיכת המסד מהענן; זוכר את ה-revision כבסיס לכתיבה הבאה */
  async pull(): Promise<PullResult | null> {
    const file = await this.findFile();
    if (!file) return null;
    const res = await this.request(`${DRIVE}/files/${file.id}?alt=media`, {}, 'download');
    const db = (await res.json()) as Db;
    this.fileId = file.id;
    this.baseRevisionId = file.headRevisionId;
    return { db, fileId: file.id, revisionId: file.headRevisionId };
  }

  /** יצירת הקובץ אם אינו קיים */
  async createFile(db: Db): Promise<string> {
    const folderId = await this.ensureFolder();
    const meta: Record<string, unknown> = { name: this.fileName, mimeType: 'application/json' };
    if (folderId) meta.parents = [folderId];
    const res = await this.request(
      `${DRIVE}/files`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) },
      'create file'
    );
    const created = (await res.json()) as { id: string };
    this.fileId = created.id;
    await this.pushUnchecked(db);
    return created.id;
  }

  private async pushUnchecked(db: Db): Promise<void> {
    if (!this.fileId) throw new Error('fileId not set');
    await this.request(
      `${UPLOAD}/files/${this.fileId}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) },
      'upload'
    );
    this.baseRevisionId = await this.headRevision(this.fileId);
  }

  /** כתיבה עם בדיקת קונפליקט: זורקת ConflictError אם הענן התקדם מאז ה-pull */
  async push(db: Db): Promise<void> {
    if (!this.fileId) throw new Error('fileId not set — קרא pull() או createFile() קודם');
    if (this.baseRevisionId) {
      const head = await this.headRevision(this.fileId);
      if (head !== this.baseRevisionId) throw new ConflictError();
    }
    await this.pushUnchecked(db);
  }

  /**
   * שמירה בטוחה: push, ועל קונפליקט — pull, מיזוג, push שוב.
   * מחזירה את המסד הסופי (אחרי מיזוג אם היה) כדי שהאפליקציה תאמץ אותו.
   */
  async safeSave(db: Db, maxRetries = 3): Promise<Db> {
    let current = db;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.push(current);
        return current;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt === maxRetries) throw e;
        const remote = await this.pull();
        if (remote) current = mergeDb(current, remote.db);
      }
    }
    return current;
  }
}
