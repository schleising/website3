const FOOTBALL_FALLBACK_URL = "https://www.schleising.net/football/";
const FOOTBALL_WEBAPP_URL = "https://football.schleising.net/";

function resolveSafeUrl(value, fallback) {
    if (typeof value !== "string" || value.trim() === "") {
        return fallback;
    }

    try {
        return new URL(value, self.location.origin).toString();
    } catch (_) {
        return fallback;
    }
}

self.addEventListener('push', function (event) {
    console.log('Push received:', event);

    var data = {};
    if (event.data) {
        data = event.data.json();
    }

    var title = data.title || 'Push Notification';
    var options = {
        body: data.body || 'This is a push notification.',
        icon: data.icon,
        badge: data.badge,
        data: {
            url: resolveSafeUrl(data.url, FOOTBALL_FALLBACK_URL),
            webappUrl: resolveSafeUrl(data.webapp_url, FOOTBALL_WEBAPP_URL),
        },
        requireInteraction: data.requireInteraction || false
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.onnotificationclick = event => {
    event.notification.close();

    const notificationData = event.notification.data || {};
    const fallbackUrl = resolveSafeUrl(notificationData.url, FOOTBALL_FALLBACK_URL);
    const preferredWebAppUrl = resolveSafeUrl(notificationData.webappUrl, FOOTBALL_WEBAPP_URL);
    const preferredOrigin = new URL(preferredWebAppUrl).origin;

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clientList => {
            for (const client of clientList) {
                if (client.url.startsWith(preferredOrigin) && "focus" in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                try {
                    const openedWebApp = await clients.openWindow(preferredWebAppUrl);
                    if (openedWebApp) {
                        return openedWebApp;
                    }
                } catch (_) {
                    // Fall back to existing www client or open www URL below.
                }
            }

            for (const client of clientList) {
                if (client.url === fallbackUrl && "focus" in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(fallbackUrl);
            }

            return undefined;
        })
    );
};

// Add a fetch event listener to the service worker
self.addEventListener('fetch', function (event) {
    console.log('Fetch event:', event);
});
