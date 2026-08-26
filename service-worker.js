const CACHE_NAME = "porteros-cache-v25";
const FILES_TO_CACHE = [
  "./index.html",
  "./app.js",
  "./styles.css",
  "./vendor/sentry-bundle.min.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.min.js"
];

// Solo la carcasa pública de la aplicación puede almacenarse en caché. Las respuestas
// de Supabase contienen información privada y nunca deben guardarse en Cache Storage.
const CACHEABLE_URLS = new Set(
  FILES_TO_CACHE.map((path) => new URL(path, self.location.href).href)
);

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
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const esNavegacion = event.request.mode === "navigate";
  const esRecursoCacheable = CACHEABLE_URLS.has(requestUrl.href);

  // No interceptamos APIs ni ningún recurso que no esté en la lista pública permitida.
  if (!esNavegacion && !esRecursoCacheable) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && esRecursoCacheable) {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return res;
      })
      .catch(() =>
        caches.match(esNavegacion ? "./index.html" : event.request).then((cacheada) =>
          cacheada || new Response("Sin conexión y sin copia guardada de este recurso.", {
            status: 503,
            statusText: "Sin conexión",
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
        )
      )
  );
});
