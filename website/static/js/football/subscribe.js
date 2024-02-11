subscribeButton = document.getElementById('subscribe-button');

// Disable all buttons until the service worker is ready
subscribeButton.disabled = true;

function setButtonState() {
    // Set the button state according to the push registration
    // Get the active service worker
    navigator.serviceWorker.getRegistration('/js/football/service-worker.js')
        .then(function (registration) {
            registration.pushManager.getSubscription()
                .then(function (subscription) {
                    if (subscription == null) {
                        console.log('No subscription object found');
                        subscribeButton.textContent = 'Subscribe';
                        subscribeButton.onclick = subscribe;
                    } else {
                        console.log('Subscription object found:', subscription);
                        subscribeButton.textContent = 'Unsubscribe';
                        subscribeButton.onclick = unsubscribe;
                    }

                    subscribeButton.disabled = false;
                });
        });
}

// Add event listener for the page to be ready to use
document.addEventListener('DOMContentLoaded', function () {
    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        console.log('Service Worker is supported, registering...');

        // Register the service worker
        registration = navigator.serviceWorker.register('/js/football/service-worker.js');

        // Add event listener for the service worker to be ready
        registration.then(function (registration) {
            console.log('Service Worker registered:', registration);

            // Set the button state according to the push registration
            setButtonState();
        });

    } else {
        console.warn('Service Worker is not supported');
    }
});

// Function to convert base64 string to Uint8Array
function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

// Function to send the subscription object to your server
function sendSubscriptionToServer(subscription) {
    if (subscription == null) {
        console.error('Subscription object is null');
        return;
    }

    // Send an HTTP request to your server with the subscription object
    // You would typically use fetch or another AJAX method here
    console.log('Sending subscription to server:', subscription);

    // Send the subscription object to the subscribe endpoint
    fetch('/football/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
    });
}

function subscribe() {
    // Disable the button until the subscription is done
    subscribeButton.disabled = true;

    // Set the button text to subscribing
    subscribeButton.textContent = 'Subscribing...';

    // Check if the browser supports service workers and push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        // Register the service worker
        navigator.serviceWorker.getRegistration('/js/football/service-worker.js')
            .then(function (registration) {
                console.log('Service Worker registered:', registration);

                // Request permission for push notifications
                return registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array('BAE-ATyX2xQGdyv9W5vcsI7qzA1FSui3UYNHgKFSKMmR12_7L9xQcVcDz8JbweMOTWb7npz6VMQMQC1BUylu00E')
                });
            })
            .then(function (subscription) {
                console.log('Push subscription object:', subscription);

                // Send the subscription object to your server for storage
                sendSubscriptionToServer(subscription);

                // Set the button state according to the push registration
                setButtonState();
            })
            .catch(function (error) {
                console.error('Service Worker registration failed:', error);
            });
    } else {
        console.warn('Push messaging is not supported');
    }
}

function unsubscribePushNotification(subscription) {
    if (subscription == null) {
        console.error('Subscription object is null');
        return;
    }

    // Send an HTTP request to your server with the subscription object
    // You would typically use fetch or another AJAX method here
    console.log('Sending unsubscription to server:', subscription);

    // Send the subscription object to the unsubscribe endpoint
    fetch('/football/unsubscribe', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
    });
}

function unsubscribe() {
    // Disable the button until the unsubscription is done
    subscribeButton.disabled = true;

    // Set the button text to unsubscribing
    subscribeButton.textContent = 'Unsubscribing...';

    // Get the active service worker
    navigator.serviceWorker.getRegistration('/js/football/service-worker.js')
        .then(function (registration) {
            console.log('Service Worker registration:', registration);

            // Unsubscribe from push notifications
            registration.pushManager.getSubscription()
                .then(function (subscription) {
                    console.log('Push subscription object:', subscription);

                    if (subscription == null) {
                        console.log('No subscription object found');
                        return;
                    }

                    // Send the subscription object to your server for deletion
                    unsubscribePushNotification(subscription);

                    return subscription.unsubscribe()
                        .then(function (success) {
                            console.log('Unsubscribed from push notifications:', success);

                            // Set the button state according to the push registration
                            setButtonState();
                        });
                });
        })
        .catch(function (error) {
            console.error('Push unsubscription failed:', error);
        });
}
