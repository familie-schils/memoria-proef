// Service worker voor proef 0a: zorgt dat de testpagina zelf zonder internet opent.
// De video's staan niet in deze cache maar in OPFS of IndexedDB (zie app.js).
const CACHE = "proef0a-pagina-v1";
const BESTANDEN = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "basis.mp4"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/testvideos/")) return;
  // Eerst het netwerk (zodat een nieuwe versie van de pagina aankomt), anders de bewaarde kopie.
  e.respondWith(
    fetch(e.request)
      .then((antwoord) => {
        if (antwoord.ok) {
          const kopie = antwoord.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwoord;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))),
  );
});
