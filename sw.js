const CACHE = 'pmovies-v5';
const SHELL = [
  '/pmovies-app/',
  '/pmovies-app/index.html',
  '/pmovies-app/manifest.json',
  '/pmovies-app/icons/icon-192.png',
  '/pmovies-app/icons/icon-512.png',
];

/* ── Install: pre-cache the app shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

/* ── Activate: delete old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch strategy ── */
const API_HOSTS = [
  'api.themoviedb.org',
  'image.tmdb.org',
  'googleapis.com',
  'firestore.googleapis.com',
  'rss2json.com',
  'www.youtube.com',
];

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for live API data
  if (API_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for the app shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
