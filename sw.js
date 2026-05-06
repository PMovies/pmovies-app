const CACHE_NAME = 'pmovies-v80';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ───────── INSTALL ───────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

/* ───────── ACTIVATE ───────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Delete all old caches so users never get a stale version
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );

      // Take control of all open tabs immediately
      await self.clients.claim();

      // Tell every open tab a new version is ready → triggers the toast in index.html
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
    })()
  );
});

/* ───────── FETCH ───────── */

// All hosts that serve dynamic / live data — always go to network first,
// fall back to cache only when offline.
const API_HOSTS = [
  'api.themoviedb.org',
  'image.tmdb.org',
  'googleapis.com',
  'pmovies-f0ddc-default-rtdb.europe-west1.firebasedatabase.app',
  'rss2json.com',
  'www.youtube.com',
  'img.youtube.com',
  'corsproxy.io',
  'allorigins.win',
  'thingproxy.freeboard.io',
  'letterboxd.com',
];

function isApiRequest(url) {
  return API_HOSTS.some(host => url.hostname.includes(host));
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* ── 1. API / dynamic data: network-first ── */
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  /* ── 2. HTML navigation: network-first ── */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  /* ── 3. Static assets (icons, manifest …): cache-first ── */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      });
    })
  );
});
