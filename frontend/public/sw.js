/**
 * S.A.T.U.R.N. service worker — APP SHELL ONLY.
 *
 * Rule: cache the shell, never cache data.
 *
 *  * Precache: index.html, the built JS/CSS, the manifest and icons.
 *  * Network-only (never cached, never replayed from cache):
 *      - /api/**            (agent tasks, imagery plans, saved data)
 *      - GIBS tile and WMTS URLs
 *      - Nominatim, EONET, FIRMS
 *      - anything with an Authorization header
 *
 * That means private responses can never leak between users on a shared device,
 * and stale imagery can never be presented as current — which the honesty rules
 * in this project require.
 */

const VERSION = 'saturn-v1';
const SHELL_CACHE = `${VERSION}-shell`;

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** True for anything that must never be served from a cache. */
function isNeverCached(url, request) {
  const u = new URL(url);
  if (u.pathname.startsWith('/api/')) return true;
  if (request.headers.has('authorization')) return true;
  const host = u.hostname;
  if (host.endsWith('gibs.earthdata.nasa.gov')) return true;
  if (host.endsWith('nasa.gov')) return true;
  if (host.endsWith('openstreetmap.org')) return true;
  if (host.includes('googleapis.com')) return true;
  // Vite dev server and HMR must always hit the network.
  if (u.pathname.startsWith('/@') || u.pathname.startsWith('/src/')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (isNeverCached(request.url, request)) return; // straight to network

  // Navigation requests: network first, fall back to the cached shell so the
  // app still opens offline (with its offline banner).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets: cache first, then network, and store successful responses.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
