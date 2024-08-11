const serviceWorkerPath = '/sw.js';

// The chart data to be fetched from the server
var deviceData = null;

// Scale and translation factors for the x and y axes
var xScale = 0;
var yScale = 0;
var xTrans = 0;
var yTrans = 0;

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

    // Fetch the time series temperature data
    fetchTemperatureData();

    // Update the temperature data every 5 seconds
    setInterval(fetchTemperatureData, 5000);
});

// Add event listener for the page to be resized
window.addEventListener('resize', () => {
    // Draw the device data if it exists
    if (deviceData != null) {
        drawDeviceData();
    }
});

// Function draw the device data on the canvas
function drawDeviceData() {
    for (let i = 0; i < deviceData.length; i++) {
        drawChart(deviceData[i].device_id, deviceData[i].data);
    }
}

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
                timeString = new Date(element.timestamp).toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

// Fetch the time series temperature data from the server
async function fetchTemperatureData() {
    // Fetch the temperature data
    fetch('/tools/monitor/timeseries/')
        .then(response => response.json())
        .then(response_data => {
            // Update the temperature data
            deviceData = response_data.data;
            drawDeviceData();
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        }
        );
}

function convertRemToPixels(rem) {
    return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// Scale and translate the x value to the canvas
function scaleAndTranslateX(time) {
    return time * xScale + xTrans;
}

// Scale and translate the y value to the canvas
function scaleAndTranslateY(temp) {
    return temp * yScale + yTrans;
}

// Draw the grid and the chart
function drawChart(deviceId, deviceData) {
    // Get the canvas and context
    const canvas = document.getElementById('canvas-' + deviceId);
    const context = canvas.getContext('2d');

    // Get the width and height of the main div
    const width = document.getElementById("data-container").offsetWidth;
    const height = width * 0.5625;

    // Set the canvas width and height to the main div width and height * 0.5625
    canvas.width = width;
    canvas.height = height;

    // Clear the canvas and make the background cornflower blue
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e4ecfc';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const inset = 30;
    const gridWidth = width - 2 * inset;
    const gridHeight = height - 2 * inset;

    // Get the minimum and maximum time as milliseconds since epoch
    const minTime = new Date(deviceData[0].timestamp).getTime();
    const maxTime = new Date(deviceData[deviceData.length - 1].timestamp).getTime();

    // Get the difference in time in milliseconds
    const timeDiff = maxTime - minTime;

    // Get the minimum and maximum temperature floor and ceiling
    const minTemp = Math.floor(Math.min(...deviceData.map(data => data.temp)));
    const maxTemp = Math.ceil(Math.max(...deviceData.map(data => data.temp)));

    // Get the difference in temperature
    const tempDiff = maxTemp - minTemp;

    // Calculate the x and y scaling factors
    xScale = gridWidth / timeDiff;
    yScale = -gridHeight / tempDiff;

    // Calculate the x and x translation factors after scaling
    xTrans = -minTime * xScale + inset;
    yTrans = -maxTemp * yScale + inset;

    // Draw the grid in temperature and time scaling to the canvas
    drawGrid(context, minTime, maxTime, minTemp, maxTemp);

    // Draw the ticks on the grid in temperature and time scaling to the canvas
    drawTicks(context, deviceData, minTime, maxTime, minTemp, maxTemp);

    // Draw the temperature data on the grid in temperature and time scaling to the canvas
    drawTemperatureData(context, deviceId, deviceData, inset, height - inset);
}

function drawGrid(context, minTime, maxTime, minTemp, maxTemp) {
    // Set the line width for the grid
    context.lineWidth = 0.75;

    // Set the colour of the grid to black
    context.strokeStyle = '#202020';

    // Draw graph axes
    context.beginPath();
    context.moveTo(scaleAndTranslateX(minTime), scaleAndTranslateY(maxTemp));
    context.lineTo(scaleAndTranslateX(minTime), scaleAndTranslateY(minTemp));
    context.lineTo(scaleAndTranslateX(maxTime), scaleAndTranslateY(minTemp));
    context.stroke();
}

function drawTicks(context, deviceData, minTime, maxTime, minTemp, maxTemp) {
    // Set the tick length to be the minimum of 10 and 1% of the width
    const tickLength = 10;

    // Set the font for the ticks and lower the font weight
    context.font = '0.65rem Helvetica';

    // Set the colour of the text to black
    context.fillStyle = '#333';

    // Store the last time tick
    let lastTimeTick = new Date(deviceData[0].timestamp).getHours();

    // Draw the hourly data ticks
    for (let i = 0; i < deviceData.length; i++) {
        const t = new Date(deviceData[i].timestamp);

        if (t.getHours() == lastTimeTick) {
            continue;
        }

        const x = scaleAndTranslateX(t.getTime());
        context.beginPath();
        context.moveTo(x, scaleAndTranslateY(minTemp));
        context.lineTo(x, scaleAndTranslateY(minTemp) + tickLength);
        context.stroke();
        hourText = t.getHours();
        hourWidth = context.measureText(hourText).width;
        context.fillText(hourText, x - (hourWidth / 2), scaleAndTranslateY(minTemp) + tickLength + 15);
        lastTimeTick = t.getHours();
    }

    // Draw the hourly temperature data ticks with the min and max temperatures
    temperatureSteps = Math.ceil(maxTemp - minTemp);

    for (let i = 0; i <= temperatureSteps; i++) {
        // Set the colour of the grid to black
        context.strokeStyle = '#222';
        const y = scaleAndTranslateY(minTemp + i);
        context.beginPath();
        context.moveTo(scaleAndTranslateX(minTime), y);
        context.lineTo(scaleAndTranslateX(minTime) - tickLength, y);
        context.stroke();

        tempText = minTemp + i;
        tempHeight = context.measureText(tempText).actualBoundingBoxAscent - context.measureText(tempText).actualBoundingBoxDescent;
        context.fillText(tempText, scaleAndTranslateX(minTime) - tickLength - 15, y + (tempHeight / 2));

        if (i == 0) {
            // Skip the first temperature tick as it is the same as the y-axis
            continue;
        }

        // Set the colour of the grid to grey and draw a thin line at the temperature tick
        context.strokeStyle = '#ddd';
        context.beginPath();
        context.moveTo(scaleAndTranslateX(minTime), y);
        context.lineTo(scaleAndTranslateX(maxTime), y);
        context.stroke();
    }
}

function drawTemperatureData(context, deviceId, deviceData, minHeight, maxHeight) {
    // Set the line width for the temperature data
    context.lineWidth = 1;

    // Set the colour of the temperature data to red
    context.strokeStyle = 'cornflowerblue';

    // Draw the temperature data
    let path = new Path2D();
    path.moveTo(scaleAndTranslateX(new Date(deviceData[0].timestamp).getTime()), scaleAndTranslateY(deviceData[0].temp));
    for (let i = 1; i < deviceData.length; i++) {
        path.lineTo(scaleAndTranslateX(new Date(deviceData[i].timestamp).getTime()), scaleAndTranslateY(deviceData[i].temp));
    }
    context.stroke(path);

    // Get the canvas element and add event listeners for the mouse move and leave events
    let canvas = document.getElementById('canvas-' + deviceId);

    canvas.addEventListener('mousemove', function (event) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;

        // Work out the intercept of the path with a vertical line at x
        for (let y = minHeight; y < maxHeight; y++) {
            if (context.isPointInStroke(path, x, y)) {
                // Populate the time and temperature values with the values at the mouse position
                // Convert the x and y values back to the original time and temperature values
                const time = (x - xTrans) / xScale;
                const temp = (y - yTrans) / yScale;
                document.getElementById("time-" + deviceId).innerText = new Date(time).toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                document.getElementById("temperature-" + deviceId).innerText = temp.toFixed(1) + '°C';
                break;
            }
        }
    });

    canvas.addEventListener('mouseleave', function (_) {
        // Reset the time and temperature values to the last values in the device data array
        document.getElementById("time-" + deviceId).innerText = new Date(deviceData[deviceData.length - 1].timestamp).toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        document.getElementById("temperature-" + deviceId).innerText = deviceData[deviceData.length - 1].temp.toFixed(1) + '°C';
    });

}
