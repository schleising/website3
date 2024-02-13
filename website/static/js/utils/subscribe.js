subscribeButton = document.getElementById('subscribe-button');

const serviceWorkerPath = '/service-worker.js';

function setButtonState() {
    // Set the button state according to the push registration
    // Get the active service worker
    navigator.serviceWorker.ready
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
        })
        .catch((error) => {
            console.error("Failed to get Service Worker or Push Subscription", error);

            subscribeButton.hidden = true;
            subscribeButton.disabled = true;
        });
}

// Function to update the registration of the service worker or register it if it does not exist
async function updateServiceWorkerRegistration() {
    // Get the active service worker
    registration = await navigator.serviceWorker.getRegistration(serviceWorkerPath);

    if (registration != null) {
        console.log('Service Worker already registered, updating...');
        return await registration.update();
    } else {
        console.log('Service Worker not registered, registering...');
        return await navigator.serviceWorker.register(serviceWorkerPath);
    }
}

// Add event listener for the page to be ready to use
document.addEventListener('DOMContentLoaded', () => {
    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        // Create the service worker and register it
        updateServiceWorkerRegistration()
            .then(() => navigator.serviceWorker.ready)
            .then((registration) => {
                console.log('Service Worker DOM:', registration.active);
                registration.active.postMessage({
                    type: 'update-page',
                    page: window.location.href
                })

                // Set the button state according to the push registration
                setButtonState();
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    } else {
        console.warn('Service Worker is not supported');
    }

    // Set the button state according to the push registration
    // setButtonState();
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
async function sendSubscriptionToServer(subscription) {
    if (subscription == null) {
        return;
    }

    // Send the subscription object to the subscribe endpoint
    result = await fetch('/football/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
    });

    if (result.status != 201) {
        // Unsubscribe the user from push notifications
        await subscription.unsubscribe();
        throw new Error('Failed to send subscription to server', result);
    }
}

function subscribe() {
    // Disable the button until the subscription is done
    subscribeButton.disabled = true;

    // Set the button text to subscribing
    subscribeButton.textContent = 'Subscribing...';

    // Check if the browser supports service workers and push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        // Register the service worker
        navigator.serviceWorker.ready
            .then((registration) => registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('BAE-ATyX2xQGdyv9W5vcsI7qzA1FSui3UYNHgKFSKMmR12_7L9xQcVcDz8JbweMOTWb7npz6VMQMQC1BUylu00E')
            }))
            .then((subscription) => sendSubscriptionToServer(subscription))
            .then(() => {
                console.log('Push subscription successful');

                // Set the button state according to the push registration
                setButtonState();
            })
            .catch((error) => {
                console.error('Push subscription failed:', error);

                // Set the button state according to the push registration
                setButtonState();
            });
    } else {
        console.warn('Push messaging is not supported');

        // Set the button state according to the push registration
        setButtonState();
    }
}

async function unsubscribePushNotification(subscription) {
    if (subscription == null) {
        return;
    }

    // Send the subscription object to the unsubscribe endpoint
    result = await fetch('/football/unsubscribe', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
    });

    if (result.status != 204) {
        throw new Error('Failed to send unsubscription to server', result);
    }

    // Unsubscribe the user from push notifications
    await subscription.unsubscribe();
}

function unsubscribe() {
    // Disable the button until the unsubscription is done
    subscribeButton.disabled = true;

    // Set the button text to unsubscribing
    subscribeButton.textContent = 'Unsubscribing...';

    // Get the active service worker
    navigator.serviceWorker.getRegistration('/js/football/service-worker.js')
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => unsubscribePushNotification(subscription))
        .then(() => {
            console.log('Push unsubscription successful');

            // Set the button state according to the push registration
            setButtonState();
        })
        .catch((error) => {
            console.error('Push unsubscription failed:', error);

            // Set the button state according to the push registration
            setButtonState();
        });
}
