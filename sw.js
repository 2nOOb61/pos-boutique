// ============================================================
// SERVICE WORKER — Boutique POS
// Stratégie : Stale-While-Revalidate pour HTML/JS/CSS — chargement
//             INSTANTANÉ depuis le cache (crucial en réseau lent/instable,
//             ex. data mobile à quelques Ko/s) + mise à jour en arrière-plan.
//             Cache First pour icônes/manifest.
// ============================================================
const CACHE_NAME = 'boutique-pos-v85';
const OFFLINE_URL = './index.html';

const STATIC_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── INSTALL ────────────────────────────────────────────────
// skipWaiting() retiré de l'install : une mise à jour mid-session peut interrompre
// une transaction en cours. L'activation est déclenchée via message SKIP_WAITING
// depuis l'app (cf. listener 'message' en bas de fichier).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' })))
    )
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
    /\.html(\?.*)?$/.test(url) || url.endsWith('/') ||
    /\.js(\?.*)?$/.test(url)   ||
    /\.css(\?.*)?$/.test(url)
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
    // Stale-While-Revalidate pour HTML/JS/CSS : répondre depuis le CACHE
    // immédiatement (chargement instantané même en réseau très lent), puis
    // rafraîchir le cache en arrière-plan (requête conditionnelle → 304 si
    // inchangé = très peu de données). Réseau direct seulement au 1er chargement.
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached || caches.match(OFFLINE_URL));
        return cached || networkFetch;
      })
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
