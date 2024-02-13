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

// On reciept of a message from the client, update the page that should be shown when the notification is clicked
self.addEventListener('message', function (event) {
    console.log('Service Worker received message:', event);

    if (event.data.type === 'update-page') {
        self.page = event.data.page;
        self.addEventListener('notificationclick', function (event) {
            console.log('Notification clicked:', event);
        
            event.notification.close();
        
            event.waitUntil(
                clients.openWindow(self.page)
            );
        });
    }
});
