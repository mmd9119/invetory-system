
const CACHE_NAME = "inventory-v2";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./config.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(FILES_TO_CACHE);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("inventory-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  // فایل‌های اصلی سایت: اول از حافظه، سپس اینترنت
  const isAppFile = FILES_TO_CACHE.some((file) =>
    url.pathname.endsWith(file.replace("./", ""))
  );

  if (isAppFile) {
    event.respondWith(
      caches.match(event.request).then(async (cached) => {
        if (cached) return cached;

        try {
          const response = await fetch(event.request);

          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, response.clone());
          }

          return response;
        } catch {
          return caches.match("./index.html");
        }
      })
    );

    return;
  }

  // سایر درخواست‌ها: اول اینترنت، در صورت قطع اینترنت حافظه
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }

        return response;
      })
      .catch(async () => {
        return (
          await caches.match(event.request)
        ) || (
          await caches.match("./index.html")
        );
      })
  );
});
