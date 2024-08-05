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

// Add event listener for the page to be ready to use
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

    // Fetch the latest sensor data
    fetchSensorData();

    // Update the sensor data every 5 seconds
    setInterval(fetchSensorData, 5000);
});

// Fetch the latest temperature data from the server every 5 seconds and update the page
async function fetchSensorData() {
    // Fetch the sensor data
    fetch('/tools/monitor/latest_data/')
        .then(response => response.json())
        .then(response_data => {
            // Update the sensor data on the page
            response_data.data.forEach(element => {
                // Update the device name
                document.getElementById("device-" + element.device_id).innerText = element.device_name;

                // Update the time data in Tue, 01 Jan, 21:54 format
                timeString = new Date(element.timestamp).toLocaleString([], {weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'});
                document.getElementById("time-" + element.device_id).innerText = timeString;

                // Update the status data
                statusString = element.online ? "Online" : "Offline";
                document.getElementById("status-" + element.device_id).innerText = statusString;

                // Update the temperature data to 1 decimal place
                document.getElementById("temperature-" + element.device_id).innerText = element.temperature.toFixed(1) + "°C";

                // Update the humidity data to 1 decimal place
                document.getElementById("humidity-" + element.device_id).innerText = element.humidity.toFixed(1) + "%";
            });
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        });
}