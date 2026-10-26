// ============================================
// Sovereign Service Worker
// Offline-First Architecture | Zero 404 Errors
// ============================================

const CACHE_NAME = 'sovereign-voice-engine-v2026';
const STATIC_ASSETS = [
    '/sovereign-voice-engine.html',
    '/fuse-medicine-search.js',
    '/drug-data-synchronizer.js'
];

// Install - Cache static assets
self.addEventListener('install', (event) => {
    console.log('[Sovereign SW] Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Sovereign SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[Sovereign SW] Install complete - skipping waiting');
                return self.skipWaiting();
            })
    );
});

// Activate - Clean old caches
self.addEventListener('activate', (event) => {
    console.log('[Sovereign SW] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log('[Sovereign SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[Sovereign SW] Activation complete');
                return self.clients.claim();
            })
    );
});

// Fetch - Cache-first strategy with network fallback
self.addEventListener('fetch', (event) => {
    const { request } = event;
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip external API calls - enforce offline mode
    const url = new URL(request.url);
    if (url.hostname !== self.location.hostname && 
        !url.hostname.includes('localhost') &&
        !url.hostname.includes('127.0.0.1')) {
        console.log('[Sovereign SW] Blocking external request:', url.hostname);
        event.respondWith(
            new Response(JSON.stringify({
                error: 'External API blocked - Sovereign mode active',
                offline: true,
                localOnly: true
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            })
        );
        return;
    }
    
    // Cache-first strategy
    event.respondWith(
        caches.match(request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Return cached response immediately
                    // Fetch new version in background
                    fetch(request)
                        .then(networkResponse => {
                            if (networkResponse.ok) {
                                caches.open(CACHE_NAME)
                                    .then(cache => cache.put(request, networkResponse));
                            }
                        })
                        .catch(() => {
                            // Network failed - we already returned cache
                            console.log('[Sovereign SW] Network failed, serving from cache');
                        });
                    
                    return cachedResponse;
                }
                
                // Not in cache - fetch from network
                return fetch(request)
                    .then(networkResponse => {
                        if (!networkResponse.ok) {
                            throw new Error('Network response not ok');
                        }
                        
                        // Cache the response
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, responseClone));
                        
                        return networkResponse;
                    })
                    .catch(error => {
                        console.log('[Sovereign SW] Network fetch failed:', error);
                        
                        // Return offline fallback
                        return new Response(`
                            <!DOCTYPE html>
                            <html>
                            <head><title>Sovereign Voice - Offline</title></head>
                            <body>
                                <h1>النظام يعمل في الوضع غير المتصل</h1>
                                <p>جميع البيانات محلية 100%</p>
                            </body>
                            </html>
                        `, {
                            headers: { 'Content-Type': 'text/html' }
                        });
                    });
            })
    );
});

// Background sync for offline queue
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-inventory') {
        console.log('[Sovereign SW] Background sync triggered');
        event.waitUntil(syncInventory());
    }
});

async function syncInventory() {
    // In a real implementation, this would sync with local DB
    console.log('[Sovereign SW] Inventory sync complete (local only)');
}

// Push notifications for voice alerts (optional)
self.addEventListener('push', (event) => {
    const data = event.data.json();
    
    event.waitUntil(
        self.registration.showNotification('Sovereign Voice Engine', {
            body: data.message,
            icon: '/icon.png',
            badge: '/badge.png',
            tag: 'sovereign-voice'
        })
    );
});

// Message handling from main thread
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data === 'getStatus') {
        event.ports[0].postMessage({
            status: 'active',
            offline: true,
            cacheName: CACHE_NAME
        });
    }
});

console.log('[Sovereign SW] Service Worker loaded - Zero external dependencies');
