// Path to the service worker script
const serviceWorkerPath = '/sw.js';

// Function to update the registration of the service worker or register it if it does not exist
async function updateServiceWorkerRegistration() {
    // Get the active service worker
    registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (registration != null) {
        console.log('Service Worker already registered, updating...');
        return await registration.update();
    } else {
        console.log('Service Worker not registered, registering...');
        return await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if the browser supports service workers
    if ('serviceWorker' in navigator) {
        // Create the service worker and register it
        updateServiceWorkerRegistration()
            .then(() => navigator.serviceWorker.ready)
            .then((registration) => {
                console.log('Service Worker DOM:', registration.active);
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    } else {
        console.warn('Service Worker is not supported');
    }

    // Get all of the last-logged elements and reform them into Date objects
    document.querySelectorAll('.last-logged').forEach((element) => {
        // Check if the element is not 'Never'
        if (element.innerText !== 'Never') {
            // Get the date from the element
            const date = new Date(element.innerText);

            // Update the element with the new date
            element.innerText = date.toLocaleString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    });

    // Add the event listener for the add button
    document.getElementById('add-event').addEventListener('click', () => {
        // Get the value of the input
        const value = document.getElementById('event').value;

        // Check if the value is not empty
        if (value !== '') {
            // Fetch with a PUT request to the server to add the event
            fetch('/tools/logger/create/', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ event: value })
            })
            .then((response) => {
                if (response.ok) {
                    // Clear the input value
                    document.getElementById('event').value = '';

                    // Get the response as JSON
                    return response.json();
                } else {
                    // Throw an error to catch the error
                    throw new Error('Event type already exists');
                }
            })
            .then((_) => {
                // Refresh the page to update the list of events
                location.reload();
            })
            .catch((error) => {
                console.error('Failed to add event (catch):', error);

                // Get the error element
                const error_element = document.getElementById('error-message');

                // Update the element with the error message
                error_element.innerText = error;

                // Show the error message
                errorPopover = document.getElementById('error-popover');

                // Show the error popover
                errorPopover.showPopover();

                // Hide the error popover after 3 seconds
                setTimeout(() => {
                    errorPopover.hidePopover();
                }, 3000);
            });
        }
    });

    // Add the event listener to all event-logger buttons to log the event
    document.querySelectorAll('.event-logger').forEach((button) => {
        button.addEventListener('click', () => {
            // Get the value of the button
            const value = button.innerText;

            // Fetch with a POTS request to the server to add the event
            fetch('/tools/logger/log/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ log: value })
            })
                .then((response) => {
                    if (response.ok) {
                        // Get the response as JSON
                        return response.json();
                    } else {
                        console.error('Failed to add event:', response.status);
                    }
                })
                .then((data) => {
                    // Get the date element with the event value
                    const date_element = document.getElementById(data.event + '-date');
                    date = new Date(data.log_date);

                    // Update the element with the new date
                    date_element.innerText = date.toLocaleString('en-GB', { 
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit' 
                    });

                    // Get the count element with the event value
                    const count_element = document.getElementById(data.event + '-count');

                    // Update the element with the new count
                    count_element.innerText = data.count;
                })
                .catch((error) => {
                    console.error('Failed to add event:', error);
                });
        });
    });
});
