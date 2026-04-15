const CACHE_NAME = 'field-app-cache-v2';
const ASSETS_TO_CACHE = [
  './field.html',
  './field-style.css',
  './field-app.js',
  './field-manifest.json',
  './favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(ASSETS_TO_CACHE.map(url => cache.add(url).catch(e => console.warn('Cache miss:', url, e))));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((cacheNames) => {
    return Promise.all(cacheNames.map((cache) => { if (cache !== CACHE_NAME) return caches.delete(cache); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('googleapis.com')) return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => { cache.put(event.request, response.clone()); return response; });
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') return caches.match('./field.html');
    })
  );
});
