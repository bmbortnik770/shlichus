/**
 * בדיקת גרסה: הדפדפן שומר עותק של הדף עד 10 דקות, ולכן אחרי עדכון אפשר לראות גרסה ישנה.
 * בכל כניסה, כשחוזרים ללשונית, וכל 5 דקות — משווים את קובץ הקוד בדף הנוכחי לזה שבשרת,
 * ואם יצאה גרסה חדשה טוענים אותה (רק כשאין עריכה פתוחה).
 */
const current = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src.split('/').pop() ?? '';

async function check(): Promise<void> {
  const mine = current();
  if (!mine) return; // מצב פיתוח
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.text()).match(/assets\/(index-[^"']+\.js)/)?.[1];
    if (!latest || latest === mine) return;
    // לא מרעננים באמצע עריכה (חלון פתוח או כרטיס משפחה עם שינויים)
    if (document.querySelector('.dialog, .drawer')) { setTimeout(() => void check(), 60_000); return; }
    location.reload();
  } catch {
    /* אין רשת — ננסה בפעם הבאה */
  }
}

export function startUpdateCheck(): void {
  void check();
  setInterval(() => void check(), 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
}
