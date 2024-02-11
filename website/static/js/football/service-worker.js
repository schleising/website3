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
        badge: data.badge
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function (event) {
    console.log('Notification clicked:', event);

    event.notification.close();

    event.waitUntil(
        clients.openWindow('https://www.schleising.net/football/')
    );
});
