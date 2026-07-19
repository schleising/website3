const UNITS_CACHE_VERSION = "units-webapp-v1";
const UNITS_SHELL_URLS = [
    "/",
    "/length/",
    "/css/base.css?v1.3.2",
    "/css/dropdown-menus.css?v1.3.1",
    "/css/right-nav.css?v1.1.0",
    "/css/units/units.css?v1.0.0",
    "/js/base.js?v1.2.22",
    "/js/site-select-menu.js?v1.0.6",
    "/js/units/pwa.js?v1.0.0",
    "/js/units/units-page.js?v1.0.0",
    "/icons/units/android-chrome-192x192.png?v1.0.0"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(UNITS_CACHE_VERSION).then(cache => cache.addAll(UNITS_SHELL_URLS)).catch(() => null)
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys
                .filter(key => key.startsWith("units-webapp-") && key !== UNITS_CACHE_VERSION)
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

    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).catch(() => caches.match("/") || caches.match("/length/"))
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
                caches.open(UNITS_CACHE_VERSION).then(cache => cache.put(event.request, clone)).catch(() => null);
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
