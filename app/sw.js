// השליחות שלי — שירות רקע מינימלי: מאפשר התקנה, ופותח את האפליקציה גם בלי רשת (העותק האחרון).
// תמיד קודם רשת — כך כל עדכון שמתפרסם מגיע מיד, והמטמון הוא רק גיבוי.
const CACHE = 'shlichus-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || /\/assets\//.test(req.url))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/shlichus/app/' : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/shlichus/app/' : req).then((r) => r || Response.error())),
  );
});
