/**
 * field-sw.js  —  Service Worker לאפליקציית השטח
 * מטמין את קבצי האפליקציה לעבודה אופליין.
 * עדכוני Outbox שמורים ב-localStorage עד לחזרת הקליטה.
 */

const CACHE_NAME = 'field-crm-v1';
const STATIC_FILES = [
    'field.html',
    'field-style.css',
    'field-app.js',
    'field-manifest.json',
    'favicon.ico',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&display=swap'
];

// Install — cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.allSettled(
                STATIC_FILES.map(url => cache.add(url).catch(() => {}))
            );
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network-first for Drive API, cache-first for static
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Always go to network for Drive API calls
    if (url.includes('googleapis.com') || url.includes('mapbox')) {
        event.respondWith(
            fetch(event.request).catch(() =>
                new Response(JSON.stringify({ error: 'offline' }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Cache-first for everything else
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
        })
    );
});
