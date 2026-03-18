const CACHE_NAME = 'weekmenu-v2';
const MAX_CACHE_ITEMS = 50;
const PRECACHE_URLS = ['/', '/manifest.json'];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Weekmenu - Offline</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#FEFCF8;color:#333;text-align:center}
.c{padding:2rem}h1{color:#2D5A3D;font-size:1.5rem}p{color:#666;margin-top:0.5rem}
button{margin-top:1rem;padding:0.75rem 1.5rem;background:#2D5A3D;color:#fff;border:none;border-radius:0.75rem;font-size:1rem;cursor:pointer}</style>
</head><body><div class="c"><h1>Geen verbinding</h1><p>Je bent offline. Check je internetverbinding.</p>
<button onclick="location.reload()">Opnieuw proberen</button></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // API requests — network only, no caching
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Navigation requests — network first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || new Response(OFFLINE_HTML, {
              headers: { 'Content-Type': 'text/html' },
            })
          )
        )
    );
    return;
  }

  // Static assets — cache first, network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(async (cache) => {
            await cache.put(request, clone);
            // Limit cache size
            const keys = await cache.keys();
            if (keys.length > MAX_CACHE_ITEMS) {
              await cache.delete(keys[0]);
            }
          });
        }
        return response;
      });
    })
  );
});
