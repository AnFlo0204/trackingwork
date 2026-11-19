const CACHE_NAME = 'trackingwork-shell-v3';
const SHELL_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache dynamic API endpoints or service worker script
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  // Always fetch HTML navigations fresh so deployments take effect immediately
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (
          res.ok &&
          (url.pathname.startsWith('/_next/static/') || SHELL_ASSETS.includes(url.pathname))
        ) {
          const clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(request)),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
