const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `purepasture-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately
const STATIC_ASSETS = [
  '.',
  'index.html',
  'manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,500&family=Inter:wght@400;500;600;700;800&display=swap'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Force the waiting service worker to become active
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients
      return self.clients.claim();
    })
  );
});

// Fetch event - Cache First strategy with network fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return event.respondWith(fetch(request));
  }

  // API requests - Network First
  if (url.pathname.startsWith('/api/') || url.hostname.includes('api.telegram.org')) {
    return event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache API responses for offline use
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clonedResponse);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
  }

  // Static assets - Cache First
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached response and update in background
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, networkResponse.clone());
                });
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        // Not in cache - fetch from network
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clonedResponse = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, clonedResponse);
              });
              return networkResponse;
            }
            return networkResponse;
          })
          .catch(() => {
            // If offline and not in cache, show offline page for HTML requests
            if (request.headers.get('accept').includes('text/html')) {
              return caches.match(OFFLINE_URL) || new Response(
                '<html><body style="background:#0A0A0A;color:#F5F5F5;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><h2>📡 You\'re Offline</h2><p>Please check your connection.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync - Queue failed requests for later retry
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
});

// Push notifications support
self.addEventListener('push', (event) => {
  const data = event.data.json();
  const options = {
    body: data.body || 'Check out our latest offers!',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"%3E%3Crect width="512" height="512" rx="80" fill="%23111111"/%3E%3Ctext x="256" y="340" font-size="280" text-anchor="middle" font-family="serif" fill="%23C89B3C"%3E🥩%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"%3E%3Crect width="512" height="512" rx="80" fill="%23111111"/%3E%3Ctext x="256" y="340" font-size="280" text-anchor="middle" font-family="serif" fill="%23C89B3C"%3E🥩%3C/text%3E%3C/svg%3E',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  event.waitUntil(
    self.registration.showNotification('Pure Pasture Beef', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});

// Helper function for sync
async function syncOrders() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.match('/sync-queue');
  if (requests) {
    // Process queued requests
    const queue = await requests.json();
    for (const item of queue) {
      try {
        await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body
        });
      } catch (err) {
        // Keep in queue for next sync
        console.error('Sync failed for:', item.url, err);
      }
    }
  }
}
