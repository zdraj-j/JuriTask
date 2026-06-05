/**
 * JuriTask — Service Worker
 * App-shell offline. NO cachea datos de Firestore/Auth (esos van siempre a la
 * red; la persistencia offline de datos la maneja el SDK de Firestore).
 */
const VERSION = 'juritask-v5';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

// Recursos propios (mismo origen) que forman el "esqueleto" de la app.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/tramites.js',
  './js/filters.js',
  './js/calendar.js',
  './js/ui.js',
  './js/firebase.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/notifications.js',
  './js/drive.js',
  './js/config.js',
  './js/icons.js',
  './js/a11y.js',
  './js/selection.js',
  './js/commandpalette.js',
  './assets/logo/logo.png',
  './assets/logo/favicon.png',
  './assets/logo/icon-192.png',
  './assets/logo/icon-512.png',
  './assets/logo/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Cachear de forma resiliente: un fallo individual no aborta la instalación.
    await Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Endpoints de datos/identidad que NUNCA deben cachearse.
function isDynamicApi(url) {
  return /firestore\.googleapis\.com|identitytoolkit|securetoken|firebaseio\.com|firebaseinstallations|googleapis\.com\/.*\/(documents|channel)/i.test(url);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isDynamicApi(req.url)) return; // dejar pasar a la red sin tocar

  // Navegación: network-first con fallback al app-shell cacheado (offline).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch (_) {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Mismo origen: cache-first y refresco en segundo plano.
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
    return;
  }

  // Recursos estáticos de terceros (librerías, fuentes): stale-while-revalidate.
  if (['script', 'style', 'font', 'image'].includes(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
  // Resto: comportamiento por defecto (red).
});
