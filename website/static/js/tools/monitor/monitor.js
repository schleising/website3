const serviceWorkerPath = '/sw.js';

// The chart data to be fetched from the server
/**
 * @type {Array<{device_id: string, data: Array<{timestamp: string, temp: number, humidity: number}>}>}
 */
var deviceData = null;

/**
 * @type {Map<string, DOMMatrix>} 
 */
var transformationMatrices = new Map();

// Scale the time data by 1000 to convert from milliseconds to seconds
const timeScale = 1000;

// x and y border padding
const xPadding = 30;
const yPadding = 40;

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

    // Add event listener for the page to be resized
    window.addEventListener('resize', () => {
        // Draw the device data if it exists
        if (deviceData != null) {
            updateCharts();
        }
    });

    // Add event listenter for each mouse / touch move on each svg element
    document.querySelectorAll('svg').forEach(svg => {
        // Add event listener for mouse move on each svg element
        svg.addEventListener('mousemove', (event) => {
            // Get the clientX and clientY of the mouse event
            const clientX = event.clientX;
            const clientY = event.clientY;

            // Handle the move event
            handleMoveEvent(svg, clientX, clientY);
        });

        // Add event listener for touch move on each svg element
        svg.addEventListener('touchmove', (event) => {
            // Get the clientX and clientY of the touch event
            const clientX = event.touches[0].clientX;
            const clientY = event.touches[0].clientY;

            // Handle the move event
            handleMoveEvent(svg, clientX, clientY);
        }, { passive: true });

        // Add event listener for mouse leave on each svg element
        svg.addEventListener('mouseleave', () => {
            // Remove the circle on mouse leave
            const circle = svg.querySelector('.temperature-circle');
            if (circle != null) {
                circle.remove();
            }
        });

        // Add event listener for touch end on each svg element
        svg.addEventListener('touchend', () => {
            // Remove the circle on touch end
            const circle = svg.querySelector('.temperature-circle');
            if (circle != null) {
                circle.remove();
            }
        });
    });
});

function handleMoveEvent(svg, clientX, clientY) {
    // Draw a circle on the polyline closest to the mouse position in the x axis
    // Get the closest point to the mouse position
    // Get the mouse position in the SVG element
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mousePosition = point.matrixTransform(svg.getScreenCTM().inverse());

    // Get the device id from the svg id by stripping the "svg-container-" prefix
    const device_id = svg.id.split("-")[1] + "-" + svg.id.split("-")[2];

    // Get the child polyline element
    const polyline = svg.querySelector('.temperature');

    // Iterate over the length of the polyline and get the closest point to the mouse position in the x axis
    let closestPoint = null;
    let closestDistance = Number.MAX_VALUE;

    for (let i = 0; i < polyline.points.length; i++) {
        const p = polyline.points[i];
        const distance = Math.abs(p.x - mousePosition.x);

        if (distance < closestDistance) {
            closestPoint = p;
            closestDistance = distance;
        }
    }

    // Draw a circle on the closest point
    const circle = svg.querySelector('.temperature-circle');
    if (circle != null) {
        circle.remove();
    }

    const newCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    newCircle.setAttribute("class", "temperature-circle");
    newCircle.setAttribute("cx", closestPoint.x);
    newCircle.setAttribute("cy", closestPoint.y);
    newCircle.setAttribute("r", 5);
    newCircle.setAttribute("fill", "red");
    svg.appendChild(newCircle);

    // Update the temperature and time data labels
    const temperature = document.getElementById("temperature-" + device_id);
    const time = document.getElementById("time-" + device_id);

    // Transform the point to the original coordinates
    const matrix = transformationMatrices.get(device_id);
    const originalPoint = matrix.inverse().transformPoint(closestPoint);

    // Set the temperature and time data
    temperature.innerText = originalPoint.y.toFixed(1) + "°C";
    time.innerText = new Date(originalPoint.x * timeScale)
        .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
                timeString = new Date(element.timestamp)
                    .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
            drawCharts();
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        });
}

// Function to draw the charts of the temperature data
function drawCharts() {
    // Loop through the device data and draw the charts
    deviceData.forEach(element => {
        // Get the device data
        const device_id = element.device_id;
        const data = element.data;

        // Draw the chart
        drawChart(device_id, data);
    });
}

// Function to update the charts of the temperature data
function updateCharts() {
    // Loop through the device data and update the charts
    deviceData.forEach(element => {
        // Get the device data
        const device_id = element.device_id;
        const data = element.data;

        // Update the chart
        updateChart(device_id, data);
    });
}

// Function to get the transformation matrix of the chart
/**
 * @param {string} device_id
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 */
function setTransformationMatrix(device_id, data) {
    // Get the chart svg element
    const svgContainer = document.getElementById("svg-container-" + device_id);

    // Get the width of the SVG container
    const width = svgContainer.clientWidth;

    // Set the height of the SVG container to maintain a 16:9 aspect ratio
    const height = (width * 9 / 16);
    svgContainer.style.height = height + "px";

    // Get the minimum and maximum temperature values
    const minTemp = Math.floor(Math.min(...data.map(d => d.temp)));
    const maxTemp = Math.ceil(Math.max(...data.map(d => d.temp)));

    // Get the minimum and maximum timestamp values
    const minTimestamp = new Date(data[0].timestamp).getTime() / timeScale;
    const maxTimestamp = new Date(data[data.length - 1].timestamp).getTime() / timeScale;

    // Get the x and y translation needed to move the top left corner to the origin
    const xTranslation = -minTimestamp;
    const yTranslation = -maxTemp;

    // Get the x and y scale needed to fit the data in the SVG container
    const xScale = (width - 2 * xPadding) / (maxTimestamp - minTimestamp);
    const yScale = (height - 2 * yPadding) / (maxTemp - minTemp);

    // Create the transformation matrix
    const matrix = new DOMMatrix()
        .translateSelf(xPadding, yPadding)
        .scaleSelf(xScale, -yScale)
        .translateSelf(xTranslation, yTranslation);

    // Set the transformation matrix
    transformationMatrices.set(device_id, matrix);
}

// Function to draw the chart of the temperature data
function drawChart(device_id, data) {
    // Set the transformation matrix of the chart
    setTransformationMatrix(device_id, data);

    // Get the chart svg element
    const svg = document.getElementById("chart-" + device_id);

    // Remove all existing children of the SVG element
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }

    // Set the width and height of the SVG element
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    // Draw the grid
    drawGrid(svg, device_id, data);

    // Draw the temperature data
    drawTemperature(svg, device_id, data);
}

/**
 * Function to draw the grid for the chart
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @returns {void}
 */
function drawGrid(svg, device_id, data) {
    // Get the transformation matrix of the chart
    const matrix = transformationMatrices.get(device_id);

    // Get the minimum and maximum temperature values
    const minTemp = Math.floor(Math.min(...data.map(d => d.temp)));
    const maxTemp = Math.ceil(Math.max(...data.map(d => d.temp)));

    // Get the minimum and maximum timestamp values
    const minTimestamp = new Date(data[0].timestamp).getTime() / timeScale;
    const maxTimestamp = new Date(data[data.length - 1].timestamp).getTime() / timeScale;

    // Create the top left, bottom left and bottom right corners of the grid
    const topLeft = matrix.transformPoint(new DOMPoint(minTimestamp, maxTemp));
    const bottomLeft = matrix.transformPoint(new DOMPoint(minTimestamp, minTemp));
    const bottomRight = matrix.transformPoint(new DOMPoint(maxTimestamp, minTemp));

    // Remove the existing grid if it exists
    const existingGrid = document.getElementById("grid-" + device_id);
    if (existingGrid != null) {
        svg.removeChild(existingGrid);
    }

    // Create the grid group
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    grid.setAttribute("class", "grid");
    grid.setAttribute("id", "grid-" + device_id);
    svg.appendChild(grid);

    // Create a polyline for the axes
    const axes = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    axes.setAttribute("class", "axes");
    axes.setAttribute("id", "axes-" + device_id);
    axes.setAttribute("fill", "none");
    axes.setAttribute("stroke", "black");
    axes.setAttribute("stroke-width", "1");
    axes.setAttribute("points", `${topLeft.x},${topLeft.y} ${bottomLeft.x},${bottomLeft.y} ${bottomRight.x},${bottomRight.y}`);
    grid.appendChild(axes);

    // Create the x axis labels
    const xLabels = document.createElementNS("http://www.w3.org/2000/svg", "g");
    xLabels.setAttribute("class", "x-labels");
    xLabels.setAttribute("id", "x-labels-" + device_id);
    grid.appendChild(xLabels);

    // Create the y axis labels
    const yLabels = document.createElementNS("http://www.w3.org/2000/svg", "g");
    yLabels.setAttribute("class", "y-labels");
    yLabels.setAttribute("id", "y-labels-" + device_id);
    grid.appendChild(yLabels);

    // Create the x axis grid lines
    const xGrid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    xGrid.setAttribute("class", "x-grid");
    xGrid.setAttribute("id", "x-grid-" + device_id);
    grid.appendChild(xGrid);

    // Create the y axis grid lines
    const yGrid = document.createElementNS("http://www.w3.org/2000/svg", "g");
    yGrid.setAttribute("class", "y-grid");
    yGrid.setAttribute("id", "y-grid-" + device_id);
    grid.appendChild(yGrid);

    // Create the x axis ticks and labels, one tick per hour
    const xTickInterval = 2 * 60 * 60 * 1000 / timeScale;
    const xTickStart = Math.ceil(minTimestamp / xTickInterval) * xTickInterval;
    const xTickEnd = Math.floor(maxTimestamp / xTickInterval) * xTickInterval;
    for (let xTick = xTickStart; xTick <= xTickEnd; xTick += xTickInterval) {
        // Get the transformed x position of the tick
        const x = matrix.transformPoint(new DOMPoint(xTick, minTemp)).x;

        // Create the x axis tick
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("class", "x-tick");
        tick.setAttribute("x1", x);
        tick.setAttribute("y1", bottomLeft.y);
        tick.setAttribute("x2", x);
        tick.setAttribute("y2", bottomLeft.y + 5);
        tick.setAttribute("stroke", "black");
        tick.setAttribute("stroke-width", "1");
        xGrid.appendChild(tick);

        // Create the x axis label
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "x-label");
        label.setAttribute("x", x);
        label.setAttribute("y", bottomLeft.y + 20);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "12");
        label.textContent = new Date(xTick * timeScale).toLocaleTimeString([], { hour: '2-digit' });
        xLabels.appendChild(label);
    }

    // Add the x axis label
    const xLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xLabel.setAttribute("class", "x-label");
    xLabel.setAttribute("x", bottomRight.x);
    xLabel.setAttribute("y", bottomRight.y + 40);
    xLabel.setAttribute("text-anchor", "end");
    xLabel.setAttribute("font-size", "12");
    xLabel.textContent = "Time";
    xLabels.appendChild(xLabel);

    // Create the y axis ticks and labels, one tick per degree
    const yTickInterval = 1;
    const yTickStart = Math.ceil(minTemp / yTickInterval) * yTickInterval;
    const yTickEnd = Math.floor(maxTemp / yTickInterval) * yTickInterval;

    for (let yTick = yTickStart; yTick <= yTickEnd; yTick += yTickInterval) {
        // Get the transformed y position of the tick
        const y = matrix.transformPoint(new DOMPoint(minTimestamp, yTick)).y;

        // Create the y axis tick
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("class", "y-tick");
        tick.setAttribute("x1", topLeft.x);
        tick.setAttribute("y1", y);
        tick.setAttribute("x2", topLeft.x - 5);
        tick.setAttribute("y2", y);
        tick.setAttribute("stroke", "black");
        tick.setAttribute("stroke-width", "1");
        yGrid.appendChild(tick);

        // Create the y axis label
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "y-label");
        label.setAttribute("x", topLeft.x - 10);
        label.setAttribute("y", y + 5);
        label.setAttribute("text-anchor", "end");
        label.setAttribute("font-size", "12");
        label.textContent = yTick;
        yLabels.appendChild(label);
    }

    // Add the y axis label
    const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yLabel.setAttribute("class", "y-label");
    yLabel.setAttribute("x", topLeft.x - 30);
    yLabel.setAttribute("y", topLeft.y - 20);
    yLabel.setAttribute("text-anchor", "start");
    yLabel.setAttribute("font-size", "12");
    yLabel.textContent = "Temperature (°C)";
    yLabels.appendChild(yLabel);
}

function updateChart(device_id, data) {
    // Set the transformation matrix of the chart
    setTransformationMatrix(device_id, data);

    // Get the chart svg element
    const svg = document.getElementById("chart-" + device_id);

    // Draw the grid
    drawGrid(svg, device_id, data);

    // Update the temperature data
    drawTemperature(svg, device_id, data);
}

// Function to draw the temperature data on the chart
function drawTemperature(svg, device_id, data) {
    // Get the transformation matrix of the chart
    const matrix = transformationMatrices.get(device_id);

    // Get the temperature data points
    const points = data.map(d => matrix.transformPoint(new DOMPoint(new Date(d.timestamp).getTime() / timeScale, d.temp)));

    // Remove the existing temperature data if it exists
    const existingTemperature = document.getElementById("temperature-line-" + device_id);
    if (existingTemperature != null) {
        svg.removeChild(existingTemperature);
    }

    // Create the temperature data path
    const temperature = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    temperature.setAttribute("class", "temperature");
    temperature.setAttribute("id", "temperature-line-" + device_id);
    temperature.setAttribute("fill", "none");
    temperature.setAttribute("stroke", "dodgerblue");
    temperature.setAttribute("stroke-width", "1");
    temperature.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    svg.appendChild(temperature);
}
