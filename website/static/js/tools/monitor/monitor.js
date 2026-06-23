const serviceWorkerPath = '/sw.js';
const chartSettingsStorageKey = 'monitor.chartSettings';

// The chart data to be fetched from the server
/**
 * @type {Array<{device_id: string, data: Array<{timestamp: string, temp: number, humidity: number}>}>}
 */
var deviceData = null;

/**
 * @type {Map<string, DOMMatrix>} 
 */
var transformationMatrices = new Map();

/** @type {'daily' | 'weekly'} */
let chartPeriod = 'daily';
let showPreviousPeriod = false;

// Scale the time data by 1000 to convert from milliseconds to seconds
const timeScale = 1000;
const dayMs = 24 * 60 * 60 * 1000;
const weekMs = 7 * dayMs;

// x and y border padding
const xPadding = 30;
const yPadding = 40;
let isReloadingForUpdate = false;

/** @type {Map<string, {temperature: number, timestamp: string}>} */
const latestSensorReadings = new Map();

/** @type {{device_id: string, scrubTimestamp: number} | null} */
let activeScrubState = null;

/**
 * @param {number} value
 * @returns {string}
 */
function formatTemperature(value) {
    return value.toFixed(1) + "°C";
}

/**
 * @param {string} device_id
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function getDeviceTimeseries(device_id) {
    const device = deviceData?.find(element => element.device_id === device_id);
    return device?.data ?? [];
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {Date} targetTime
 * @returns {number | null}
 */
function getClosestTemperatureAtTime(data, targetTime) {
    if (data.length === 0) {
        return null;
    }

    const targetMs = targetTime.getTime();
    let closestPoint = data[0];
    let closestDistance = Math.abs(new Date(closestPoint.timestamp).getTime() - targetMs);

    for (const point of data) {
        const distance = Math.abs(new Date(point.timestamp).getTime() - targetMs);
        if (distance < closestDistance) {
            closestPoint = point;
            closestDistance = distance;
        }
    }

    return closestPoint.temp;
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @returns {number | null}
 */
function getHistoricTemperatureAtNow(data) {
    if (!showPreviousPeriod) {
        return null;
    }

    const now = new Date();
    const currentBounds = getPeriodBounds(chartPeriod, 0);
    const previousBounds = getPeriodBounds(chartPeriod, 1);
    const elapsedMs = now.getTime() - currentBounds.start.getTime();
    const historicTarget = new Date(previousBounds.start.getTime() + elapsedMs);
    const previousData = filterDataForPeriod(data, chartPeriod, 1);

    return getClosestTemperatureAtTime(previousData, historicTarget);
}

/**
 * @param {string} device_id
 * @param {number} currentTemp
 * @param {number | null | undefined} overlayTemp
 */
function updateTemperatureReadout(device_id, currentTemp, overlayTemp = null) {
    const readout = document.getElementById("temperature-" + device_id);
    if (readout == null) {
        return;
    }

    const currentValue = readout.querySelector(".temperature-current-value");
    const overlayValue = readout.querySelector(".temperature-overlay-value");
    if (currentValue == null || overlayValue == null) {
        return;
    }

    currentValue.textContent = formatTemperature(currentTemp);

    if (showPreviousPeriod && overlayTemp != null) {
        overlayValue.textContent = formatTemperature(overlayTemp);
        overlayValue.hidden = false;
    } else {
        overlayValue.textContent = "";
        overlayValue.hidden = true;
    }
}

/**
 * @param {string} device_id
 */
function restoreLiveReadouts(device_id) {
    const latestReading = latestSensorReadings.get(device_id);
    if (latestReading == null) {
        return;
    }

    const time = document.getElementById("time-" + device_id);
    if (time != null) {
        time.innerText = new Date(latestReading.timestamp)
            .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    const historicTemp = getHistoricTemperatureAtNow(getDeviceTimeseries(device_id));
    updateTemperatureReadout(device_id, latestReading.temperature, historicTemp);
}

/**
 * @param {SVGPolylineElement | null} polyline
 * @param {number} mouseX
 * @returns {SVGPoint | null}
 */
function getClosestPointByX(polyline, mouseX) {
    if (polyline == null || polyline.points.length === 0) {
        return null;
    }

    let closestPoint = polyline.points[0];
    let closestDistance = Math.abs(closestPoint.x - mouseX);

    for (let i = 1; i < polyline.points.length; i++) {
        const point = polyline.points[i];
        const distance = Math.abs(point.x - mouseX);
        if (distance < closestDistance) {
            closestPoint = point;
            closestDistance = distance;
        }
    }

    return closestPoint;
}

/**
 * @param {SVGElement} svg
 * @param {string} className
 * @param {SVGPoint} point
 */
function setScrubMarker(svg, className, point) {
    let marker = svg.querySelector("." + className);
    if (marker == null) {
        marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        marker.setAttribute("class", className);
        marker.setAttribute("r", "5");
        svg.appendChild(marker);
    }

    marker.setAttribute("cx", String(point.x));
    marker.setAttribute("cy", String(point.y));
}

/**
 * @param {SVGElement} svg
 */
function clearScrubMarkers(svg) {
    svg.querySelectorAll(".temperature-circle-current, .temperature-circle-overlay").forEach(marker => {
        marker.remove();
    });
}

/**
 * @param {string} device_id
 * @param {number} chartX
 */
function applyScrubAtChartX(device_id, chartX) {
    const svg = document.getElementById("chart-" + device_id);
    const matrix = transformationMatrices.get(device_id);
    if (svg == null || matrix == null) {
        return;
    }

    const currentPolyline = svg.querySelector('.temperature-current') ?? svg.querySelector('.temperature');
    const closestCurrentPoint = getClosestPointByX(currentPolyline, chartX);
    if (closestCurrentPoint == null) {
        return;
    }

    clearScrubMarkers(svg);

    const currentOriginalPoint = matrix.inverse().transformPoint(closestCurrentPoint);
    let overlayTemp = null;

    const overlayPolyline = svg.querySelector('.temperature-overlay');
    const closestOverlayPoint = getClosestPointByX(overlayPolyline, chartX);
    if (showPreviousPeriod && closestOverlayPoint != null) {
        setScrubMarker(svg, "temperature-circle-overlay", closestOverlayPoint);
        overlayTemp = matrix.inverse().transformPoint(closestOverlayPoint).y;
    }

    setScrubMarker(svg, "temperature-circle-current", closestCurrentPoint);
    updateTemperatureReadout(device_id, currentOriginalPoint.y, overlayTemp);

    const time = document.getElementById("time-" + device_id);
    if (time != null) {
        time.innerText = new Date(currentOriginalPoint.x * timeScale)
            .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    activeScrubState = { device_id, scrubTimestamp: currentOriginalPoint.x };
}

/**
 * @param {string} device_id
 */
function restoreActiveScrubMarkers(device_id) {
    if (activeScrubState == null || activeScrubState.device_id !== device_id) {
        return;
    }

    const matrix = transformationMatrices.get(device_id);
    if (matrix == null) {
        return;
    }

    const chartX = matrix.transformPoint(
        new DOMPoint(activeScrubState.scrubTimestamp, 0)
    ).x;

    applyScrubAtChartX(device_id, chartX);
}

/**
 * @param {string} device_id
 */
function clearChartScrub(device_id) {
    const svg = document.getElementById("chart-" + device_id);
    if (svg != null) {
        clearScrubMarkers(svg);
    }

    if (activeScrubState?.device_id === device_id) {
        activeScrubState = null;
        restoreLiveReadouts(device_id);
    }
}

/**
 * @param {'daily' | 'weekly'} period
 * @returns {number}
 */
function getPeriodDurationMs(period) {
    return period === 'daily' ? dayMs : weekMs;
}

/**
 * Rolling window bounds ending at now for the current period, or the
 * immediately preceding window of equal length for periodOffset 1.
 *
 * @param {'daily' | 'weekly'} period
 * @param {number} periodOffset 0 for current period, 1 for previous
 * @returns {{start: Date, end: Date}}
 */
function getPeriodBounds(period, periodOffset) {
    const now = new Date();
    const durationMs = getPeriodDurationMs(period);
    const end = new Date(now.getTime() - periodOffset * durationMs);
    const start = new Date(end.getTime() - durationMs);
    return { start, end };
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {'daily' | 'weekly'} period
 * @param {number} periodOffset
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function filterDataForPeriod(data, period, periodOffset) {
    const { start, end } = getPeriodBounds(period, periodOffset);
    return data.filter(point => {
        const timestamp = new Date(point.timestamp);
        return timestamp >= start && timestamp < end;
    });
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {'daily' | 'weekly'} period
 * @returns {Array<{timestamp: string, temp: number, humidity: number}>}
 */
function alignPreviousPeriodData(data, period) {
    const offsetMs = period === 'daily' ? dayMs : weekMs;
    return data.map(point => ({
        ...point,
        timestamp: new Date(new Date(point.timestamp).getTime() + offsetMs).toISOString(),
    }));
}

/**
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @returns {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}}
 */
function getChartSeries(data) {
    const current = filterDataForPeriod(data, chartPeriod, 0);
    const bounds = getPeriodBounds(chartPeriod, 0);
    let overlay = null;

    if (showPreviousPeriod) {
        const previous = filterDataForPeriod(data, chartPeriod, 1);
        overlay = alignPreviousPeriodData(previous, chartPeriod);
    }

    return {
        current,
        overlay,
        bounds: {
            minTimestamp: bounds.start.getTime() / timeScale,
            maxTimestamp: bounds.end.getTime() / timeScale,
        },
    };
}

function loadChartSettings() {
    try {
        const storedSettings = localStorage.getItem(chartSettingsStorageKey);
        if (storedSettings == null) {
            return;
        }

        const settings = JSON.parse(storedSettings);
        if (settings.period === 'daily' || settings.period === 'weekly') {
            chartPeriod = settings.period;
        }
        if (typeof settings.showPreviousPeriod === 'boolean') {
            showPreviousPeriod = settings.showPreviousPeriod;
        }
    } catch (error) {
        // Ignore storage read errors.
    }
}

function persistChartSettings() {
    try {
        localStorage.setItem(chartSettingsStorageKey, JSON.stringify({
            period: chartPeriod,
            showPreviousPeriod,
        }));
    } catch (error) {
        // Ignore storage write errors.
    }
}

function syncChartControls() {
    document.querySelectorAll('.period-btn').forEach(button => {
        const isActive = button.getAttribute('data-period') === chartPeriod;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    const overlayToggle = document.getElementById('overlay-toggle');
    if (overlayToggle != null) {
        overlayToggle.checked = showPreviousPeriod;
    }
}

function initializeChartControls() {
    loadChartSettings();
    syncChartControls();

    document.querySelectorAll('.period-btn').forEach(button => {
        button.addEventListener('click', () => {
            const nextPeriod = button.getAttribute('data-period');
            if (nextPeriod !== 'daily' && nextPeriod !== 'weekly') {
                return;
            }

            chartPeriod = nextPeriod;
            syncChartControls();
            persistChartSettings();

            if (deviceData != null) {
                drawCharts();
                refreshAllTemperatureReadouts();
            }
        });
    });

    const overlayToggle = document.getElementById('overlay-toggle');
    if (overlayToggle != null) {
        overlayToggle.addEventListener('change', () => {
            showPreviousPeriod = overlayToggle.checked;
            persistChartSettings();

            if (deviceData != null) {
                drawCharts();
                refreshAllTemperatureReadouts();
            }
        });
    }
}

function refreshAllTemperatureReadouts() {
    latestSensorReadings.forEach((_reading, device_id) => {
        if (activeScrubState?.device_id === device_id) {
            restoreActiveScrubMarkers(device_id);
        } else {
            restoreLiveReadouts(device_id);
        }
    });
}

function promptForWaitingWorker(registration) {
    if (!registration || !registration.waiting) {
        return;
    }

    if (window.__pwaUpdatePromptOpen === true) {
        return;
    }

    window.__pwaUpdatePromptOpen = true;
    const shouldUpdateNow = window.confirm('A new version is available. Update now?');
    if (shouldUpdateNow) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
        window.__pwaUpdatePromptOpen = false;
    }
}

function attachUpdateFlow(registration) {
    if (!registration) {
        return;
    }

    promptForWaitingWorker(registration);

    registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
            return;
        }

        installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                promptForWaitingWorker(registration);
            }
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isReloadingForUpdate) {
            return;
        }

        isReloadingForUpdate = true;
        window.location.reload();
    });
}

// Function to update the registration of the service worker or register it if it does not exist
async function updateServiceWorkerRegistration() {
    // Get the active service worker
    registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (registration != null) {
        console.log('Service Worker already registered, updating...');
        await registration.update();
        attachUpdateFlow(registration);
        return registration;
    } else {
        console.log('Service Worker not registered, registering...');
        const newRegistration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
        attachUpdateFlow(newRegistration);
        return newRegistration;
    }
}

// Add event listener for the page to be ready to use
document.addEventListener('DOMContentLoaded', () => {
    initializeChartControls();

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
            const device_id = svg.id.split("-").slice(1).join("-");
            clearChartScrub(device_id);
        });

        // Add event listener for touch end on each svg element
        svg.addEventListener('touchend', () => {
            const device_id = svg.id.split("-").slice(1).join("-");
            clearChartScrub(device_id);
        });
    });
});

function handleMoveEvent(svg, clientX, clientY) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mousePosition = point.matrixTransform(svg.getScreenCTM().inverse());
    const device_id = svg.id.split("-").slice(1).join("-");

    applyScrubAtChartX(device_id, mousePosition.x);
}

// Fetch the latest temperature data from the server every 5 seconds and update the page
async function fetchSensorData() {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    // Fetch the sensor data
    fetch('/latest_data/', { headers })
        .then(response => response.json())
        .then(response_data => {
            // Update the sensor data on the page
            response_data.data.forEach(element => {
                const containerElement = document.getElementById("data-container-" + element.device_id);

                latestSensorReadings.set(element.device_id, {
                    temperature: element.temperature,
                    timestamp: element.timestamp,
                });

                // Update the device name
                document.getElementById("device-" + element.device_id).innerText = element.device_name;

                // Update the time data in Tue, 01 Jan, 21:54 format
                if (activeScrubState?.device_id !== element.device_id) {
                    timeString = new Date(element.timestamp)
                        .toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                    document.getElementById("time-" + element.device_id).innerText = timeString;
                }

                // Update the status data
                statusString = element.online ? "Online" : "Offline";
                statusElement = document.getElementById("status-" + element.device_id);
                statusElement.innerText = statusString;
                statusElement.classList.toggle("status-online", element.online);
                statusElement.classList.toggle("status-offline", !element.online);

                if (containerElement != null) {
                    containerElement.classList.toggle("device-online", element.online);
                    containerElement.classList.toggle("device-offline", !element.online);
                }

                // Update the temperature data to 1 decimal place
                if (activeScrubState?.device_id !== element.device_id) {
                    const historicTemp = getHistoricTemperatureAtNow(getDeviceTimeseries(element.device_id));
                    updateTemperatureReadout(element.device_id, element.temperature, historicTemp);
                }

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
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    // Fetch the temperature data
    fetch('/timeseries/', { headers })
        .then(response => response.json())
        .then(response_data => {
            // Update the temperature data
            deviceData = response_data.data;
            drawCharts();
            refreshAllTemperatureReadouts();
        })
        .catch(error => {
            console.error('Error fetching temperature data:', error);
        });
}

// Function to draw the charts of the temperature data
function drawCharts() {
    deviceData.forEach(element => {
        const device_id = element.device_id;
        const data = element.data;
        const svg = document.getElementById("chart-" + device_id);

        if (svg != null && svg.querySelector(".grid") != null) {
            updateChart(device_id, data);
        } else {
            drawChart(device_id, data);
        }
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
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 */
function setTransformationMatrix(device_id, series) {
    const { current, overlay, bounds } = series;

    // Get the chart svg element
    const svgContainer = document.getElementById("svg-container-" + device_id);

    // Get the width of the SVG container
    const width = svgContainer.clientWidth;

    // Set the height of the SVG container to maintain a 16:9 aspect ratio
    const height = (width * 9 / 16);
    svgContainer.style.height = height + "px";

    const temperatures = current.map(d => d.temp);
    if (overlay != null) {
        temperatures.push(...overlay.map(d => d.temp));
    }

    const defaultTemp = 20;
    const minTemp = temperatures.length > 0 ? Math.floor(Math.min(...temperatures)) : defaultTemp - 1;
    const maxTemp = temperatures.length > 0 ? Math.ceil(Math.max(...temperatures)) : defaultTemp + 1;

    const minTimestamp = bounds.minTimestamp;
    const maxTimestamp = bounds.maxTimestamp;

    // Get the x and y translation needed to move the top left corner to the origin
    const xTranslation = -minTimestamp;
    const yTranslation = -maxTemp;

    // Get the x and y scale needed to fit the data in the SVG container
    const xRange = Math.max(maxTimestamp - minTimestamp, 1);
    const yRange = Math.max(maxTemp - minTemp, 1);
    const xScale = (width - 2 * xPadding) / xRange;
    const yScale = (height - 2 * yPadding) / yRange;

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
    const series = getChartSeries(data);

    // Set the transformation matrix of the chart
    setTransformationMatrix(device_id, series);

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
    drawGrid(svg, device_id, series);

    // Draw the temperature data
    drawTemperature(svg, device_id, series);
    restoreActiveScrubMarkers(device_id);
}

/**
 * Function to draw the grid for the chart
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {{current: Array<{timestamp: string, temp: number, humidity: number}>, overlay: Array<{timestamp: string, temp: number, humidity: number}> | null, bounds: {minTimestamp: number, maxTimestamp: number}}} series
 * @returns {void}
 */
function drawGrid(svg, device_id, series) {
    const { current, overlay, bounds } = series;

    // Get the transformation matrix of the chart
    const matrix = transformationMatrices.get(device_id);

    const temperatures = current.map(d => d.temp);
    if (overlay != null) {
        temperatures.push(...overlay.map(d => d.temp));
    }

    const defaultTemp = 20;
    const minTemp = temperatures.length > 0 ? Math.floor(Math.min(...temperatures)) : defaultTemp - 1;
    const maxTemp = temperatures.length > 0 ? Math.ceil(Math.max(...temperatures)) : defaultTemp + 1;

    const minTimestamp = bounds.minTimestamp;
    const maxTimestamp = bounds.maxTimestamp;

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

    // Create the x axis ticks and labels
    const xTickInterval = chartPeriod === 'daily'
        ? 2 * 60 * 60 * 1000 / timeScale
        : 24 * 60 * 60 * 1000 / timeScale;
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
        label.textContent = chartPeriod === 'daily'
            ? new Date(xTick * timeScale).toLocaleTimeString([], { hour: '2-digit' })
            : new Date(xTick * timeScale).toLocaleDateString([], { weekday: 'short' });
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
    const series = getChartSeries(data);

    // Set the transformation matrix of the chart
    setTransformationMatrix(device_id, series);

    // Get the chart svg element
    const svg = document.getElementById("chart-" + device_id);

    // Draw the grid
    drawGrid(svg, device_id, series);

    // Update the temperature data
    drawTemperature(svg, device_id, series);
    restoreActiveScrubMarkers(device_id);
}

/**
 * @param {SVGElement} svg
 * @param {string} device_id
 * @param {Array<{timestamp: string, temp: number, humidity: number}>} data
 * @param {string} className
 * @param {string} elementId
 */
function drawTemperatureLine(svg, device_id, data, className, elementId) {
    const matrix = transformationMatrices.get(device_id);
    const existingLine = document.getElementById(elementId);
    if (existingLine != null) {
        svg.removeChild(existingLine);
    }

    if (data.length === 0) {
        return;
    }

    const points = data.map(d => matrix.transformPoint(
        new DOMPoint(new Date(d.timestamp).getTime() / timeScale, d.temp)
    ));

    const temperature = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    temperature.setAttribute("class", className);
    temperature.setAttribute("id", elementId);
    temperature.setAttribute("fill", "none");
    temperature.setAttribute("stroke-width", "1");
    temperature.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    svg.appendChild(temperature);
}

// Function to draw the temperature data on the chart
function drawTemperature(svg, device_id, series) {
    const { current, overlay } = series;

    if (overlay != null && overlay.length > 0) {
        drawTemperatureLine(
            svg,
            device_id,
            overlay,
            "temperature-overlay",
            "temperature-overlay-line-" + device_id
        );
    } else {
        const existingOverlay = document.getElementById("temperature-overlay-line-" + device_id);
        if (existingOverlay != null) {
            svg.removeChild(existingOverlay);
        }
    }

    drawTemperatureLine(
        svg,
        device_id,
        current,
        "temperature temperature-current",
        "temperature-line-" + device_id
    );
}
