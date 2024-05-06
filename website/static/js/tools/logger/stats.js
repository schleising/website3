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

    // Get all of the log-time elements and reform them into Date objects
    document.querySelectorAll('.log-time').forEach((element) => {
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
    });

    // Add the event listener for the edit buttons
    document.querySelectorAll('.stats-edit-button').forEach((button) => {
        button.addEventListener('click', () => {
            // Get the event ID from the button
            const id = button.getAttribute('data-id');

            // Get the popover element
            const popover = document.getElementById('edit-popover');

            // Show the popover
            popover.showPopover();

            // Add the event listener for the edit button
            document.getElementById('edit-event-button').addEventListener('click', () => {
                // Get the value of the input
                const value = document.getElementById('edit-event').value;

                // Check if the value is not empty
                if (value !== '') {
                    // Fetch with a PUT request to the server to edit the event
                    fetch(`/tools/logger/edit/${id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ event: value })
                    })
                        .then((response) => {
                            if (response.ok) {
                                // Reload the page
                                window.location.reload();
                            } else {
                                // Log the error
                                console.error('Failed to edit event:', response);
                            }
                        })
                        .catch((error) => {
                            // Log the error
                            console.error('Failed to edit event:', error);
                        });
                }
            });

            // Add the event listener for the cancel button
            document.getElementById('cancel-edit').addEventListener('click', () => {
                // Hide the popover
                popover.hidePopover();
            });
        });
    });

    // Add the event listener for the edit buttons
    document.querySelectorAll('.stats-delete-button').forEach((button) => {
        button.addEventListener('click', () => {
            // Get the event ID from the button
            const id = button.getAttribute('data-id');

            // Get the popover element
            const popover = document.getElementById('delete-popover');

            // Show the popover
            popover.showPopover();

            // Add the event listener for the delete button
            document.getElementById('delete-log').addEventListener('click', () => {
                // Fetch with a DELETE request to the server to delete the event
                fetch(`/tools/logger/delete/${id}`, {
                    method: 'DELETE'
                })
                    .then((response) => {
                        if (response.ok) {
                            // Reload the page
                            window.location.reload();
                        } else {
                            // Log the error
                            console.error('Failed to delete event:', response);
                        }
                    })
                    .catch((error) => {
                        // Log the error
                        console.error('Failed to delete event:', error);
                    });
            });

            // Add the event listener for the cancel button
            document.getElementById('cancel-delete').addEventListener('click', () => {
                // Hide the popover
                popover.hidePopover();
            });
        });
    });

});
