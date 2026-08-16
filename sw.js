/* CA School Finder — service worker (offline-capable PWA)
 * Strategy:
 *  - HTML / CSS / JS  -> NETWORK-FIRST (always get latest code; cache as offline fallback)
 *  - other same-origin (data/*, icons/*) -> CACHE-FIRST (fast, offline)
 *  - cross-origin (geocoders) -> pass through
 */
const CACHE = "casf-v6";
const ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "js/data.js",
  "js/app.js",
  "data/zips.js",
  "data/schools.js",
  "data/ratings.js",
  "data/accountability.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-180.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isCodeAsset(url, req) {
  if (req.mode === "navigate") return true;
  return /\.(?:html|css|js)(?:\?.*)?$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let census/nominatim pass

  if (isCodeAsset(url, req)) {
    // NETWORK-FIRST: fetch fresh, update cache, fall back to cache offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  // CACHE-FIRST for data/icons.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
