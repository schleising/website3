/**
 * @typedef {Object} DataResponse
 * @property {Response} response
 * @property {boolean} fromCache
 */


const VERSION = "v0.0.29";
const CACHE_NAME = `football-bet-tracker-${VERSION}`;


const APP_STATIC_RESOURCES = [
    "/",
    "/css/reset.css",
    "/css/football/bet.css",
    "/images/football/crests/64.png",
    "/images/football/crests/61.png",
    "/images/football/crests/73.png",
    "/icons/football/bet/favicon-48x48.ico",
    "/manifests/football/bet.webmanifest",
    "/js/football/bet.js",
    "/football/bet/data/",
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


/**
 * Fetch and cache a resource
 * @param {string} pathname
 * @returns {Promise<DataResponse>}
 */
async function fetchAndCache(pathname) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(pathname);
        if (response.status === 200) {
            await cache.put(pathname, response.clone());
        }

        return { response, fromCache: false };
    } catch (error) {
        // Get the cached version if the network response is not OK
        const cachedResponse = await cache.match(pathname);
        if (cachedResponse) {
            return { response: cachedResponse, fromCache: true };
        }
    }
}

/**
 * Cache first strategy
 * @param {string} pathname
 * @returns {Promise<DataResponse>}
 */
async function cacheFirst(pathname) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(pathname);
    if (cachedResponse) {
        return { response: cachedResponse, fromCache: true };
    }

    networkResponse = await fetchAndCache(pathname);

    return networkResponse;
}


/** 
 * Fetch event listener
 *
 * @param {FetchEvent} event
 */

self.addEventListener("fetch", (event) => {
    // For every other request type
    event.respondWith(
        (async () => {
            const url = new URL(event.request.url);

            const fetchAndCacheUrls = [
                "/",
                "/css/football/bet.css",
                "/manifests/football/bet.webmanifest",
                "/js/football/bet.js",
                "/football/bet/data/",
            ];

            /** @type {DataResponse} */
            let dataResponse;

            if (!fetchAndCacheUrls.includes(url.pathname)) {
                dataResponse = await cacheFirst(url.pathname);
            } else {
                dataResponse = await fetchAndCache(url.pathname);
            }

            if (url.pathname === "/football/bet/data/") {
                const allClients = await clients.matchAll();

                allClients.forEach((client) => {
                    client.postMessage({ messageType: "onlineStatus", online: !dataResponse.fromCache });
                });
            }

            return dataResponse.response;
        })(),
    );
});

self.addEventListener("message", (event) => {
    if (event.data.messageType === "getCachedBetData") {
        event.waitUntil(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedResponse = await cache.match("/football/bet/data/");
                if (cachedResponse) {
                    event.source.postMessage({ messageType: "cachedBetData", data: await cachedResponse.json() });
                    event.source.postMessage({ messageType: "onlineStatus", online: false });
                }
            })(),
        );
    }
});
