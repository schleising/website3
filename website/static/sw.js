const TOOLS_CACHE_VERSION = "tools-webapp-v2";

// Warm the Converter shell when this SW is installed on converter.schleising.net
// (harmless no-ops on other tools hosts if a URL is missing).
const TOOLS_SHELL_URLS = [
    "/",
    "/css/tools/fonts.css?v2.2.0",
    "/css/tools/converter/reset.css?v4.0.0",
    "/css/tools/converter/main.css?v5.2.25",
    "/js/tools/converter/utils.js?v5.1.5",
    "/js/tools/converter/websocket.js?v5.1.15",
    "/js/tools/converter/page-layout.js?v1.0.0",
    "/js/tools/converter/scope.js?v4.0.0",
    "/js/tools/converter/theme-toggle.js?v2.0.0",
    "/js/utils/subscribe.js?v4.0.1",
    "/icons/tools/converter/converter-icon-any-20260725.svg",
    "/icons/tools/converter/art-placeholder.svg"
];

function isCacheableRequest(request, requestUrl) {
    if (request.method !== "GET") {
        return false;
    }

    if (requestUrl.origin !== self.location.origin) {
        return false;
    }

    if (
        requestUrl.pathname.includes("/ws")
        || requestUrl.pathname.endsWith("/subscribe")
        || requestUrl.pathname.endsWith("/subscribe/")
        || requestUrl.pathname.endsWith("/unsubscribe")
        || requestUrl.pathname.endsWith("/unsubscribe/")
    ) {
        return false;
    }

    return true;
}

function putInCache(request, response) {
    if (response == null || !response.ok) {
        return;
    }

    const clone = response.clone();
    caches.open(TOOLS_CACHE_VERSION).then(function (cache) {
        return cache.put(request, clone);
    }).catch(function () {
        return null;
    });
}

function precacheShell(cache) {
    return Promise.all(
        TOOLS_SHELL_URLS.map(function (url) {
            return cache.add(url).catch(function () {
                return null;
            });
        })
    );
}

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(TOOLS_CACHE_VERSION).then(precacheShell).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys
                    .filter(function (key) {
                        return key.startsWith("tools-webapp-") && key !== TOOLS_CACHE_VERSION;
                    })
                    .map(function (key) {
                        return caches.delete(key);
                    })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener("fetch", function (event) {
    const requestUrl = new URL(event.request.url);

    if (!isCacheableRequest(event.request, requestUrl)) {
        return;
    }

    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).then(function (networkResponse) {
                putInCache("/", networkResponse);
                putInCache(event.request, networkResponse);
                return networkResponse;
            }).catch(function () {
                return caches.match(event.request).then(function (cached) {
                    return cached || caches.match("/");
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(function (cached) {
            const networkFetch = fetch(event.request).then(function (networkResponse) {
                putInCache(event.request, networkResponse);
                return networkResponse;
            });

            if (cached) {
                networkFetch.catch(function () {
                    return null;
                });
                return cached;
            }

            return networkFetch;
        })
    );
});

self.addEventListener("push", function (event) {
    console.log("Push received:", event);

    var data = {};
    if (event.data) {
        data = event.data.json();
    }

    var title = data.title || "Push Notification";
    var options = {
        body: data.body || "This is a push notification.",
        icon: data.icon,
        badge: data.badge,
        data: {
            url: data.url || "/"
        },
        requireInteraction: data.requireInteraction || false
    };

    if (data.image) {
        options.image = data.image;
    }

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.onnotificationclick = (event) => {
    console.log("On notification click: ", event.notification.tag);
    event.notification.close();

    event.waitUntil(
        clients
            .matchAll({
                type: "window",
            })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url === event.notification.data.url && "focus" in client) return client.focus();
                }
                if (clients.openWindow) return clients.openWindow(event.notification.data.url);
            }),
    );
};

self.addEventListener("message", (event) => {
    if (event.data && (event.data.type === "SKIP_WAITING" || event.data.messageType === "SKIP_WAITING")) {
        self.skipWaiting();
    }
});
