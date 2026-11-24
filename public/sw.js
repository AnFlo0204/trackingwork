// Self-destructing kill-switch Service Worker:
// Eliminates Safari iOS "FetchEvent.respondWith received an error: Returned response is null"
// by removing all fetch listeners, clearing legacy caches, unregistering itself, and refreshing open windows.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        if ('caches' in self) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // ignore cache cleanup errors
      }

      try {
        await self.registration.unregister();
      } catch {
        // ignore unregister errors
      }

      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of windowClients) {
          if ('navigate' in client && client.url) {
            await client.navigate(client.url).catch(() => undefined);
          }
        }
      } catch {
        // ignore client reload errors
      }
    })(),
  );
});
