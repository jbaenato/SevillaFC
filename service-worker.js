const CACHE_NAME = "porteros-cache-v20";
const FILES_TO_CACHE = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // { cache: "reload" } evita que se cuele una copia antigua desde el propio
      // caché HTTP del navegador al construir el caché del service worker.
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
  // Red primero: si hay conexión, siempre se sirve la versión más reciente
  // y se refresca el caché de paso. Si falla (sin conexión), se usa el caché
  // guardado como reserva para que la app siga funcionando offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
