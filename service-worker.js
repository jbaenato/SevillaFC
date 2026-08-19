const CACHE_NAME = "porteros-cache-v23";
const FILES_TO_CACHE = [
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        FILES_TO_CACHE.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => cache.put(url, res))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Solo se cachean peticiones GET (login y guardado son POST y nunca deben servirse
  // desde caché ni intentar guardarse en ella; la API de Cache además no admite POST).
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cacheada) =>
          cacheada || new Response("Sin conexión y sin copia guardada de este recurso.", {
            status: 503,
            statusText: "Sin conexión",
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
        )
      )
  );
});
