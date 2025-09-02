const VERSION = 'v0.0.18';
const CACHE_NAME = `football-bet-tracker-${VERSION}`;

const APP_STATIC_RESOURCES = [
    '/',
    '/css/reset.css',
    '/css/football/bet.css',
    '/images/football/crests/64.png',
    '/images/football/crests/61.png',
    '/images/football/crests/73.png',
    '/icons/football/bet/favicon-48x48.ico',
    '/manifests/football/bet.webmanifest',
    '/js/football/bet.js',
    '/football/bet/data/',
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            cache.addAll(APP_STATIC_RESOURCES);
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                    return undefined;
                }),
            );
            await clients.claim();
        })(),
    );
});

async function fetchAndCache(pathname) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(pathname);
        if (response.status === 200) {
            await cache.put(pathname, response.clone());
            console.log(`Cached: ${pathname}`);
            return response;
        }
    } catch (error) {
        // Get the cached version if the network response is not OK
        const cachedResponse = await cache.match(pathname);
        if (cachedResponse) {
            console.log(`Serving cached: ${pathname}`);
            return cachedResponse;
        }
    }
}

async function cacheFirst(pathname) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(pathname);
    if (cachedResponse) {
        return cachedResponse;
    }
    return fetchAndCache(pathname);
}

self.addEventListener("fetch", (event) => {
    // For every other request type
    event.respondWith(
        (async () => {
            const url = new URL(event.request.url);

            if (url.pathname !== "/football/bet/data/") {
                console.log(`Using cache-first strategy for: ${url.pathname}`);
                return await cacheFirst(url.pathname);
            } else {
                console.log(`Using network-first strategy for: ${url.pathname}`);
                return await fetchAndCache(url.pathname);
            }
        })(),
    );
});
