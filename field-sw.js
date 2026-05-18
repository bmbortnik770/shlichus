// *** עדכן את המספר הזה בכל פעם שמעלים גרסה חדשה ***
const CACHE_VERSION = 'v35';
const CACHE_NAME = 'field-app-cache-' + CACHE_VERSION;

const ASSETS_TO_CACHE = [
  '/shlichus/field.html',
  '/shlichus/field-manifest.json',
  '/shlichus/assets/index-CbOQQQyy.js',
  '/shlichus/assets/vendor-C8w-UNLI.js',
  '/shlichus/assets/mapbox-D1pTBA1i.js',
  '/shlichus/assets/index-BEz5C5g0.css',
  '/shlichus/770.jpg',
  '/shlichus/icon-192.png',
  '/shlichus/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(e => console.warn('Cache miss:', url, e)))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // דלג על בקשות POST ובקשות לשרתים חיצוניים
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('googleapis.com')) return;
  if (event.request.url.includes('mapbox.com')) return;
  if (event.request.url.includes('accounts.google.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((response) => {
        // שמור רק תגובות תקינות מאותו מקור
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') return caches.match('/shlichus/field.html');
    })
  );
});
