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
        return await navigator.serviceWorker.register(serviceWorkerPath, {scope: serviceWorkerScope});
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Set a one second timer to request progress information from the server
    setInterval(() => {
        fetch('/tools/transcoder/progress/')
        .then(response => response.json())
        .then(data => {
            // Check whether there is an object called error in the response
            if (data.error) {
                // If there is, display the error message and hide the progress area
                document.getElementById('no-transcode').style.display = 'flex';
                document.getElementById('progress-area').style.display = 'none';
                return;
            }

            // Hide the no-transcode message and show the progress area
            document.getElementById('no-transcode').style.display = 'none';
            document.getElementById('progress-area').style.display = 'flex';

            // Update the progress bar, filename and speed
            document.getElementById('file-progress').value = data.percentComplete;

            // Filename is everything to the right of the last slash in the input file path
            let filename = data.inputFile.split('/').pop();
            document.getElementById('filename').innerText = filename;
            document.getElementById('speed').innerText = data.speed.toFixed(2) + 'x';

            // Convert the time remaining, which is in nanoseconds, to HH hours, MM minutes, SS seconds
            let timeRemainingMs = data.timeRemaining / 1000000;
            let timeRemaining = new Date(timeRemainingMs);
            timeRemaining.setHours(timeRemaining.getHours() - 1);

            // Construct the time remaining string
            let timeRemainingString = '';
            if (timeRemaining.getHours() > 1) {
                timeRemainingString += timeRemaining.getHours() + ' hours ';
            } else if (timeRemaining.getHours() === 1) {
                timeRemainingString += timeRemaining.getHours() + ' hour ';
            }
            if (timeRemaining.getMinutes() > 1) {
                timeRemainingString += timeRemaining.getMinutes() + ' minutes ';
            } else if (timeRemaining.getMinutes() === 1) {
                timeRemainingString += timeRemaining.getMinutes() + ' minute ';
            }
            if (timeRemaining.getSeconds() > 1 || timeRemaining.getSeconds() === 0) {
                timeRemainingString += timeRemaining.getSeconds() + ' seconds';
            } else if (timeRemaining.getSeconds() === 1) {
                timeRemainingString += timeRemaining.getSeconds() + ' second';
            }
            document.getElementById('time-remaining').innerText = timeRemainingString;

            // Convert the estimated finish time from an ISO string to a Date object
            finishTime = new Date(data.estimatedFinishTime);
            document.getElementById('finish-time').innerText = finishTime.toLocaleString('en-GB', { weekday: 'long', hour12: false, hour: '2-digit', minute: '2-digit' });

            // Update the progress value text
            document.getElementById('progress-value').innerText = data.percentComplete.toFixed(2) + '%';
        })
        .catch(_ => {
            document.getElementById('no-transcode').style.display = 'flex';
            document.getElementById('progress-area').style.display = 'none';
        });
    }, 1000);

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
});
