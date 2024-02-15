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
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.onnotificationclick = (event) => {
    console.log("On notification click: ", event.notification.tag);
    event.notification.close();

    // This looks to see if the current is already open and
    // focuses if it is
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

// Add a fetch event listener to the service worker
self.addEventListener('fetch', function (event) {
    console.log('Fetch event:', event);
});
