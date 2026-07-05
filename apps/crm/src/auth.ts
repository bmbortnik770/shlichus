/**
 * Google OAuth (GIS token client) — משתף session עם המערכת הישנה:
 * אותו CLIENT_ID, אותם scopes, ואותו מפתח localStorage (gdrive_session),
 * כך שהתחברות באחת מהן תקפה בשתיהן.
 */
import type { TokenProvider } from '@shlichus/core';

const CLIENT_ID = '348261974014-242r9b0dvctlka7rj3aetu81v96ere46.apps.googleusercontent.com';
const SCOPES =
  'email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/gmail.send';
const SESSION_KEY = 'gdrive_session';

interface Session {
  token: string;
  expiresAt: number;
}

interface GisTokenClient {
  requestAccessToken(opts: { prompt: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: string; error?: string }) => void;
          }): GisTokenClient;
        };
      };
    };
  }
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(token: string, expiresInSec: number): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ token, expiresAt: Date.now() + expiresInSec * 1000 } satisfies Session)
  );
}

let gsiLoaded: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (gsiLoaded) return gsiLoaded;
  gsiLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('טעינת Google Identity נכשלה'));
    document.head.appendChild(s);
  });
  return gsiLoaded;
}

/** בקשת טוקן; prompt='' = שקט (בלי חלון), 'consent' = התחברות מלאה */
async function requestToken(prompt: '' | 'consent'): Promise<string | null> {
  await loadGsi();
  return new Promise((resolve) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error || !resp.access_token) return resolve(null);
        writeSession(resp.access_token, parseInt(resp.expires_in ?? '3600', 10));
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt });
    // רענון שקט שלא חוזר (popup נחסם וכו') — אל תתקע את האפליקציה
    if (prompt === '') setTimeout(() => resolve(null), 8000);
  });
}

/** TokenProvider עבור DriveSync של core */
export const browserTokens: TokenProvider = {
  async getToken() {
    const s = readSession();
    return s && s.expiresAt > Date.now() + 60_000 ? s.token : null;
  },
  async refresh() {
    return requestToken('');
  },
};

/** התחברות יזומה בלחיצת כפתור */
export function interactiveLogin(): Promise<string | null> {
  return requestToken('consent');
}

/** האם יש session בתוקף (בלי רשת) */
export function hasValidSession(): boolean {
  const s = readSession();
  return !!s && s.expiresAt > Date.now() + 60_000;
}
