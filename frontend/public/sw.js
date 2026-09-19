/* FixLocal service worker — offline shell cache.
 * main.tsx registers /sw.js?v=<build id>; a new build means a new script URL,
 * a new cache name, and old caches are deleted on activate. */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `fixlocal-shell-${VERSION}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fixlocal-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function offlineShell() {
  return (await caches.match("/")) || (await caches.match("/index.html")) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses or user files.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/uploads")) return;
  // Network-first for page loads, falling back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(offlineShell)
    );
    return;
  }
  // Stale-while-revalidate for static files (built assets have hashed names).
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fetched;
    })
  );
});
