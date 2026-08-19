const CACHE_NAME = 'pmovies-v421';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ───────── INSTALL ───────── */
self.addEventListener('install', event => {
  event.waitUntil(
    // Use no-cache so install always fetches the latest files, bypassing HTTP cache
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'no-cache' })))
    )
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
  'graphql.anilist.co',
  's4.anilist.co',
];

function isApiRequest(url) {
  return API_HOSTS.some(host => url.hostname.includes(host));
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache API only supports GET — skip all non-GET requests immediately
  if (event.request.method !== 'GET') {
    return; // let browser handle it natively, no SW intervention
  }

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

  /* ── 2. HTML navigation: true network-first, bypassing HTTP cache ── */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })   // always go to origin, not HTTP cache
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

/* ───────── PUSH ───────── */

// Critical design rule: push event does ZERO network requests.
// Only the data already inside the payload is used to show the notification.
// Data is fetched ONLY when the user taps (notificationclick).
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); } catch { return; }

  const { title = 'PMovies', body = '', data = {} } = payload;

  // Stable tag collapses duplicate notifications (e.g. ranking re-runs)
  const tag = data.movieId   ? `pmovies-movie-${data.movieId}`
             : data.reviewId ? `pmovies-review-${data.reviewId}`
             : 'pmovies-general';

  const options = {
    body,
    icon:     '/icons/icon-192.png',
    badge:    '/icons/icon-192.png',   // fallback — replace with /icons/badge-72.png when available
    tag,
    renotify: false,
    data,
    vibrate:  [100, 50, 100],
    actions: [
      { action: 'open',    title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ───────── NOTIFICATION CLICK ───────── */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const payload   = event.notification.data || {};
  const targetUrl = buildNotificationUrl(payload);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // App already open — focus it and post the payload
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'PMOVIES_NOTIFICATION_CLICK', payload });
            return;
          }
        }
        // App not open — open with URL params so SPA knows what to navigate to
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      })
  );
});

function buildNotificationUrl(payload) {
  const base   = self.location.origin;
  const params = new URLSearchParams();
  if (payload.type)     params.set('pn_type',   payload.type);
  if (payload.movieId)  params.set('pn_movie',  payload.movieId);
  if (payload.userId)   params.set('pn_user',   payload.userId);
  if (payload.reviewId) params.set('pn_review', payload.reviewId);
  const qs = params.toString();
  return qs ? `${base}/?${qs}` : base + '/';
}
