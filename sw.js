/*  Road to 70.3 — service worker
 *  App-shell caching so the tracker installs and runs offline on iOS.
 *  Bump CACHE when you change cached assets to force an update.
 */
var CACHE = "r703-v15";

// Relative paths resolve against the SW scope, so this works at a subpath too
// (e.g. username.github.io/fecia_fitness/).
var SHELL = [
  "./",
  "index.html",
  "config.js",
  "sync.js",
  "intervals.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Don't let one missing asset fail the whole install.
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isSupabase(url) {
  return url.indexOf(".supabase.co") !== -1 ||
         url.indexOf("/rest/v1/") !== -1 ||
         url.indexOf("/auth/v1/") !== -1 ||
         url.indexOf("/realtime/") !== -1;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;            // never cache writes
  if (isSupabase(req.url)) return;             // always hit the network for data/auth

  // Navigations: network-first so deploys land, cache fallback when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("index.html").then(function (m) { return m || caches.match("./"); });
      })
    );
    return;
  }

  // Everything else (static assets, CDN lib, fonts): cache-first, fill on miss.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});
