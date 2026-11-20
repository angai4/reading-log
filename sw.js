/*
 * sw.js - the service worker that makes Reading Log work offline.
 *
 * On install it saves ("caches") every file the app needs. After that,
 * each request is answered from the cache straight away, and if you're
 * online a fresh copy is fetched in the background for next time
 * (a pattern called "stale-while-revalidate").
 *
 * If you add or rename a file, add it to FILES and bump the VERSION so
 * phones pick up the change cleanly.
 */

const VERSION = 'v1';
const CACHE = `reading-log-${VERSION}`;

const FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/calc.js',
  './js/chart.js',
  './js/db.js',
  './js/effects.js',
  './js/sample.js',
  './js/wheel.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Save all the app files when the service worker is first installed.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// Remove caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('reading-log-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Answer requests from the cache, refreshing it in the background.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Page loads (e.g. "./#wheel" or "./?source=pwa") all use the app page.
      const isPage = request.mode === 'navigate';
      const cached = await cache.match(isPage ? './index.html' : request, { ignoreSearch: isPage });

      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(isPage ? './index.html' : request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network); // keep the background refresh alive
        return cached;
      }
      return (await network) || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })
  );
});
