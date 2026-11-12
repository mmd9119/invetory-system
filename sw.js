
const CACHE = "magha-site-v1";

const FILES = [
  "./",
  "./index.html",
  "./config.js",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  event.respondWith(
    caches.match(event.request).then(async cached => {
      if (cached) return cached;

      try {
        const response = await fetch(event.request);

        if (response.ok && (
          url.origin === location.origin ||
          url.hostname === "cdn.jsdelivr.net"
        )) {
          const copy = response.clone();
          caches.open(CACHE).then(cache =>
            cache.put(event.request, copy)
          );
        }

        return response;
      } catch {
        if (url.origin === location.origin) {
          return caches.match("./index.html");
        }
        throw new Error("Offline");
      }
    })
  );
});
