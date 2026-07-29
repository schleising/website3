const MONITOR_CACHE_VERSION = "monitor-webapp-v6";

const MONITOR_SHELL_URLS = [
    "/",
    "/css/tools/fonts.css?v2.2.0",
    "/css/tools/monitor/reset.css?v1.1.0",
    "/css/tools/webapp-tokens.css?v1.0.0",
    "/css/tools/webapp-shell.css?v1.0.0",
    "/css/tools/monitor/monitor.css?v2.0.3",
    "/js/tools/monitor/scope.js?v1.1.0",
    "/js/tools/monitor/monitor.js?v2.0.3",
    "/js/tools/monitor/page-layout.js?v1.0.0",
    "/js/tools/monitor/theme-toggle.js?v2.0.0",
    "/icons/tools/monitor/monitor-icon-any-20260504.svg"
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
    if (!response || !response.ok) {
        return;
    }

    const responseClone = response.clone();
    caches.open(MONITOR_CACHE_VERSION).then(function (cache) {
        cache.put(request, responseClone);
    });
}

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(MONITOR_CACHE_VERSION).then(function (cache) {
            return Promise.all(
                MONITOR_SHELL_URLS.map(function (url) {
                    return cache.add(url).catch(function () {
                        return null;
                    });
                })
            );
        }).then(function () {
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
                        return key !== MONITOR_CACHE_VERSION;
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

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.onnotificationclick = (event) => {
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
