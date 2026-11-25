/* Atlas service worker: makes the app open and work offline.
 * Generated at build time (see vite.config.ts): VERSION and PRECACHE are filled in.
 *   - The app's own files are cached when a version installs (cache-first: they are content-hashed).
 *   - Page loads try the network first so updates arrive, and fall back to the cache offline.
 *   - Other same-origin files (e.g. the smart-search engine) are cached the first time they're used.
 *   - Requests to other sites (GitHub, Hugging Face, relays) are never touched.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP_CACHE = `atlas-app-${VERSION}`;
const RUNTIME_CACHE = 'atlas-runtime';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atlas-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting version to take over when the user clicks "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(APP_CACHE).then((c) => c.put('./', res.clone()));
          return res;
        })
        .catch(() => caches.match('./', { cacheName: APP_CACHE }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
