/* Snowflakes service worker: de app-schil uit de cache (snel en offline),
 * de API en de foto's altijd van het netwerk (die veranderen).
 * __VERSION__ wordt bij het deployen het commitnummer: elke versie een eigen cache. */
const VERSION = '__VERSION__';
const CACHE = 'snowflakes-' + VERSION;
const SCHIL = ['/', '/style.css', '/i18n.js', '/app.js', '/manifest.webmanifest', '/favicon.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SCHIL.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const n of await caches.keys()) if (n.startsWith('snowflakes-') && n !== CACHE) await caches.delete(n);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) return;   // altijd netwerk
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); } catch { return (await caches.match('/', { cacheName: CACHE })) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => (await caches.match(req, { cacheName: CACHE, ignoreSearch: true })) || fetch(req))());
});
