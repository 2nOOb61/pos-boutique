// ============================================================
// SERVICE WORKER — Boutique POS
// Stratégie : Network First pour HTML (toujours à jour sur refresh)
//             Cache First pour assets statiques (icons, fonts)
// ============================================================
const CACHE_NAME = 'boutique-pos-v4';
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
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('script.google.com')) return;
  if (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com')) return;
  if (event.request.url.includes('cdnjs.cloudflare.com')) return;

  const isHTML = event.request.destination === 'document' ||
                 event.request.url.endsWith('.html') ||
                 event.request.url.endsWith('/');

  if (isHTML) {
    // Network First : toujours chercher la version fraîche du réseau
    // En cas d'échec réseau (hors ligne), retourner le cache
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          // Mettre en cache la version fraîche
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
  } else {
    // Cache First pour les assets statiques (icons, etc.)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          if (event.request.destination === 'document') return caches.match(OFFLINE_URL);
        });
      })
    );
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

// ── MESSAGE ────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_VERSION') {
    event.source.postMessage({ type: 'CACHE_INFO', version: CACHE_NAME });
  }
});
