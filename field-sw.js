const CACHE_NAME = 'field-app-cache-v1';
const ASSETS_TO_CACHE = [
  './field.html',
  './field-style.css',
  './field-app.js',
  './field-manifest.json',
  './favicon.ico',
  'https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)));
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
