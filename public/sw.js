// Service worker: la app abre aunque no haya cobertura.
// Páginas: red primero, si falla, copia guardada. Recursos estáticos: caché primero.
// Al instalarse guarda las pantallas que se usan en el campo y los archivos que necesitan.
const CACHE = "cultivix-v2";
const PANTALLAS = ["/", "/trabajo", "/asistente", "/foto", "/escanear", "/cosechas", "/partes"];

async function precargar() {
  const c = await caches.open(CACHE);
  await c.addAll(["/icon.svg"]).catch(() => {});
  for (const p of PANTALLAS) {
    try {
      const r = await fetch(p, { credentials: "same-origin" });
      if (!r.ok) continue;
      await c.put(p, r.clone());
      const html = await r.text();
      const recursos = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
      await Promise.all(recursos.map((u) => c.match(u).then((ya) => ya || c.add(u)).catch(() => {})));
    } catch {}
  }
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(precargar());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const c = r.clone();
          caches.open(CACHE).then((x) => x.put(url.pathname, c));
          return r;
        })
        .catch(() => caches.match(url.pathname).then((r) => r || caches.match("/")))
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".svg")) {
    e.respondWith(
      caches.match(req).then(
        (r) =>
          r ||
          fetch(req).then((res) => {
            const c = res.clone();
            caches.open(CACHE).then((x) => x.put(req, c));
            return res;
          })
      )
    );
  }
});
