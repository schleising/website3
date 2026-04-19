const FEEDS_CACHE_VERSION = "feeds-webapp-v4";
const FEEDS_SHELL_URLS = [
    "/",
    "/settings/",
    "/css/base.css?v1.2.0",
    "/css/dropdown-menus.css?v1.2.7",
    "/css/feeds/feeds.css?v1.0.50",
    "/js/base.js?v1.2.8",
    "/js/feeds/pwa.js?v1.0.1",
    "/icons/feeds/android-chrome-192x192.png?v1.0.1"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(FEEDS_CACHE_VERSION).then(cache => cache.addAll(FEEDS_SHELL_URLS)).catch(() => null)
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys
                .filter(key => key.startsWith("feeds-webapp-") && key !== FEEDS_CACHE_VERSION)
                .map(key => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") {
        return;
    }

    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) {
        return;
    }

    // API responses must always come from network so polling reflects
    // short-lived state transitions (e.g. read-expiry removals) immediately.
    if (
        requestUrl.pathname.startsWith("/api/")
        || requestUrl.pathname.startsWith("/feeds/api/")
    ) {
        event.respondWith(fetch(event.request));
        return;
    }

    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).catch(() => caches.match("/"))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                return cached;
            }

            return fetch(event.request).then(networkResponse => {
                const clone = networkResponse.clone();
                caches.open(FEEDS_CACHE_VERSION).then(cache => cache.put(event.request, clone)).catch(() => null);
                return networkResponse;
            });
        })
    );
});

self.addEventListener("message", event => {
    if (event.data && (event.data.type === "SKIP_WAITING" || event.data.messageType === "SKIP_WAITING")) {
        self.skipWaiting();
    }
});
