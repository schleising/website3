subscribeButton = document.getElementById('subscribe-button');

function setButtonState() {
    // Set the button state according to the push registration
    // Get the active service worker
    navigator.serviceWorker.getRegistration('/js/football/service-worker.js')
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => {
            if (subscription == null) {
                subscribeButton.textContent = 'Subscribe';
                subscribeButton.onclick = subscribe;
            } else {
                subscribeButton.textContent = 'Unsubscribe';
                subscribeButton.onclick = unsubscribe;
            }

            subscribeButton.hidden = false;
            subscribeButton.disabled = false;
        });
}

// Add event listener for the page to be ready to use
document.addEventListener('DOMContentLoaded', function () {
    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        // Add event listener for the service worker to be ready
        navigator.serviceWorker.register('/js/football/service-worker.js')
            .then(() => {
                console.log('Service Worker registered');

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
        return;
    }

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
            .then((registration) => registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('BAE-ATyX2xQGdyv9W5vcsI7qzA1FSui3UYNHgKFSKMmR12_7L9xQcVcDz8JbweMOTWb7npz6VMQMQC1BUylu00E')
            }))
            .then((subscription) => {
                console.log('Push registration successful');

                // Send the subscription object to your server for storage
                sendSubscriptionToServer(subscription);

                // Set the button state according to the push registration
                setButtonState();
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    } else {
        console.warn('Push messaging is not supported');
    }
}

function unsubscribePushNotification(subscription) {
    if (subscription == null) {
        return;
    }

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
            // Unsubscribe from push notifications
            registration.pushManager.getSubscription()
                .then(function (subscription) {
                    if (subscription == null) {
                        return;
                    }

                    // Send the subscription object to your server for deletion
                    unsubscribePushNotification(subscription);

                    return subscription.unsubscribe()
                        .then(function () {
                            console.log('Push unsubscription successful');
                            // Set the button state according to the push registration
                            setButtonState();
                        });
                });
        })
        .catch(function (error) {
            console.error('Push unsubscription failed:', error);
        });
}
