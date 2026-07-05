import { describe, it, expect, vi } from 'vitest';
import { DriveSync, ConflictError, AuthRequiredError, DriveHttpError, type TokenProvider } from '../src/driveSync.js';
import type { Db } from '../src/types.js';

const tokens = (opts: { token?: string | null; refreshed?: string | null } = {}): TokenProvider => ({
  getToken: vi.fn(async () => opts.token ?? 'tok'),
  refresh: vi.fn(async () => opts.refreshed ?? null),
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch מדומה שמנתב לפי URL */
function fakeDrive(state: { db: Db; revision: string }) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/files?q=') && u.includes('vnd.google-apps.folder')) return jsonRes({ files: [{ id: 'folder1' }] });
    if (u.includes('/files?q=')) return jsonRes({ files: [{ id: 'file1', headRevisionId: state.revision }] });
    if (u.includes('fields=headRevisionId')) return jsonRes({ headRevisionId: state.revision });
    if (u.includes('alt=media')) return jsonRes(state.db);
    if (u.includes('uploadType=media') && init?.method === 'PATCH') {
      state.db = JSON.parse(String(init.body)) as Db;
      state.revision = `rev${Number(state.revision.slice(3)) + 1}`;
      return jsonRes({ id: 'file1' });
    }
    return jsonRes({}, 404);
  });
}

describe('DriveSync — בדיקת תשובות HTTP (באג 1 בישן)', () => {
  it('כשל 500 בהעלאה זורק שגיאה — לא "נשמר" שקרי', async () => {
    const fetchFn = vi.fn(async () => jsonRes({}, 500));
    const sync = new DriveSync({ tokenProvider: tokens(), fetchFn: fetchFn as unknown as typeof fetch });
    sync.fileId = 'file1';
    await expect(sync.push({ meta: { lastModified: 1 } })).rejects.toThrow(DriveHttpError);
  });

  it('401 → רענון טוקן → ניסיון חוזר מצליח', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth === 'Bearer expired') return jsonRes({}, 401);
      return jsonRes({ headRevisionId: 'rev1' });
    });
    const tp = tokens({ token: 'expired', refreshed: 'fresh' });
    const sync = new DriveSync({ tokenProvider: tp, fetchFn: fetchFn as unknown as typeof fetch });
    sync.fileId = 'file1';
    sync.baseRevisionId = null;
    // pushUnchecked דרך push בלי baseRevision: upload ואז headRevision
    await sync.push({ meta: { lastModified: 1 } });
    expect(tp.refresh).toHaveBeenCalled();
    expect(calls).toBeGreaterThan(1);
  });

  it('401 בלי יכולת רענון → AuthRequiredError ברורה', async () => {
    const fetchFn = vi.fn(async () => jsonRes({}, 401));
    const sync = new DriveSync({ tokenProvider: tokens({ refreshed: null }), fetchFn: fetchFn as unknown as typeof fetch });
    sync.fileId = 'file1';
    await expect(sync.push({ meta: { lastModified: 1 } })).rejects.toThrow(AuthRequiredError);
  });
});

describe('DriveSync — בקרת גרסאות (באג 4 בישן)', () => {
  it('pull זוכר revision; push עם ענן שהתקדם זורק ConflictError', async () => {
    const state = { db: { meta: { lastModified: 1 } } as Db, revision: 'rev1' };
    const fetchFn = fakeDrive(state);
    const sync = new DriveSync({ tokenProvider: tokens(), fetchFn: fetchFn as unknown as typeof fetch });

    const pulled = await sync.pull();
    expect(pulled!.revisionId).toBe('rev1');

    // מכשיר אחר כתב בינתיים
    state.revision = 'rev5';
    await expect(sync.push({ meta: { lastModified: 2 } })).rejects.toThrow(ConflictError);
  });

  it('safeSave על קונפליקט: מושך, ממזג, וכותב — בלי לאבד אף צד', async () => {
    const state = {
      db: { meta: { lastModified: 50 }, 'הרצל 1': { info: {}, apts: [{ name: 'מהענן', num: '2', updatedAt: 50 }] } } as Db,
      revision: 'rev5',
    };
    const fetchFn = fakeDrive(state);
    const sync = new DriveSync({ tokenProvider: tokens(), fetchFn: fetchFn as unknown as typeof fetch });
    sync.fileId = 'file1';
    sync.baseRevisionId = 'rev1'; // הבסיס שלנו ישן — הענן התקדם ל-rev5

    const localDb: Db = {
      meta: { lastModified: 100 },
      'ביאליק 3': { info: {}, apts: [{ name: 'מקומי', num: '1', updatedAt: 100 }] },
    };
    const final = await sync.safeSave(localDb);

    expect(final['ביאליק 3']).toBeDefined();
    expect(final['הרצל 1']).toBeDefined();
    // ומה שנכתב לענן הוא הממוזג
    expect(state.db['ביאליק 3']).toBeDefined();
    expect(state.db['הרצל 1']).toBeDefined();
  });

  it('safeSave בלי קונפליקט כותב ישירות', async () => {
    const state = { db: {} as Db, revision: 'rev1' };
    const fetchFn = fakeDrive(state);
    const sync = new DriveSync({ tokenProvider: tokens(), fetchFn: fetchFn as unknown as typeof fetch });
    sync.fileId = 'file1';
    sync.baseRevisionId = 'rev1';
    await sync.safeSave({ meta: { lastModified: 7 } });
    expect(state.db.meta!.lastModified).toBe(7);
  });
});
