
const CACHE_NAME = "inventory-v3";
const APP_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./config.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      APP_FILES.map(file => cache.add(file))
    );
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith("inventory-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // ذخیره کتابخانه Supabase برای اجرای برنامه در حالت آفلاین
  if (url.hostname === "esm.sh") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        if (cached) return cached;
        return new Response("کتابخانه آفلاین در دسترس نیست", {
          status: 503
        });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);

    if (cached) {
      fetch(event.request).then(response => {
        if (response.ok) cache.put(event.request, response.clone());
      }).catch(() => {});
      return cached;
    }

    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return await cache.match("./index.html") ||
        new Response("این صفحه آفلاین در دسترس نیست", { status: 503 });
    }
  })());
});
