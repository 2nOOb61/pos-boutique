// ============================================================
// SERVICE WORKER — Boutique POS
// Stratégie : Network First pour tous les fichiers locaux
//             (HTML, JS, CSS) — toujours à jour quand connecté
//             Cache First uniquement pour icônes/manifest
// ============================================================
const CACHE_NAME = 'boutique-pos-v8';
const OFFLINE_URL = './index.html';

const STATIC_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' })))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : supprime les anciens caches ─────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => {
        self.clients.claim();
        // Notifier tous les onglets qu'une mise à jour est active
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
        );
      })
  );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('script.google.com')) return;
  if (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com')) return;
  if (event.request.url.includes('cdnjs.cloudflare.com')) return;

  const url = event.request.url;
  const isSameOrigin = url.startsWith(self.location.origin);
  const isAppFile = isSameOrigin && (
    url.endsWith('.html') || url.endsWith('/') ||
    url.endsWith('.js')   ||
    url.endsWith('.css')
  );
  const isStaticAsset = url.endsWith('.png') || url.endsWith('.ico') || url.endsWith('manifest.json');

  if (isStaticAsset) {
    // Cache First pour icônes/manifest : ne changent pas souvent
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        }).catch(() => caches.match(OFFLINE_URL));
      })
    );
  } else if (isAppFile) {
    // Network First pour HTML/JS/CSS : toujours la version fraîche
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL)))
    );
  }
});

// ── MESSAGE ────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_VERSION') {
    event.source.postMessage({ type: 'CACHE_INFO', version: CACHE_NAME });
  }
  // Vider tous les caches à la demande de l'app
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      if (event.source) event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});

// ── SYNC ───────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-sales') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_REQUIRED' }))
      )
    );
  }
});
