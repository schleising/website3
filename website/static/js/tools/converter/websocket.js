// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable to identify the timer in use
var timer = 0;

// Reconnect/watchdog state for network transitions.
var reconnectTimer = 0;
var reconnectAttempt = 0;
var watchdogTimer = 0;
var lastMessageTimestamp = 0;
var lastPingTimestamp = 0;

const watchdogIntervalMs = 3000;
const staleConnectionMs = 9000;
const minPingIntervalMs = 1500;

// Variable to identify whether the page is visible, set to true by default as the page is visible when it loads
var visible = true;

// Variable to store the conversion number
var conversionNumber = 0;

// An array to store the tab names
var currentTabNames = [];

const filesViewStorageKey = 'converter.filesViewMode';

// Track which cards are shown in the lower panel.
var filesViewMode = getStoredFilesViewMode();

// Cache the latest payload for each lower-card view to avoid flicker on toggle.
var cachedConvertedFiles = null;
var cachedFilesToConvert = null;

const statisticsScaffoldFields = [
    { key: 'total_files', label: 'Total Files: ', type: 'number' },
    { key: 'total_converted', label: 'Total Files Converted: ', type: 'number' },
    { key: 'total_to_convert', label: 'Total Files to Convert: ', type: 'number' },
    { key: 'gigabytes_before_conversion', label: 'Size Before Conversion: ', type: 'size' },
    { key: 'gigabytes_after_conversion', label: 'Size After Conversion: ', type: 'size' },
    { key: 'gigabytes_saved', label: 'Space Saved: ', type: 'size' },
    { key: 'percentage_saved', label: 'Percentage Saved: ', type: 'percentage' },
    { key: 'total_conversion_time', label: 'Total Conversion Time: ', type: 'text' }
];

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        console.log("Load Event")
        // Get the page URL
        url = document.URL;

        // Replace the http or https with ws or wss respectively
        if ( url.startsWith("https") ) {
            url = url.replace("https", "wss");
        } else if ( url.startsWith("http") ) {
            url = url.replace("http", "ws");
        }

        // Append the ws to the URL
        url = url + "ws/";

        console.log("URL: " + url)

        initializeFilesViewButtons();
        initializeConverterScaffold();
        setupNetworkListeners();
        startConnectionWatchdog();

        // Check whether the websocket is open, if not open it
        openWebSocket();
    }
});

// Add an event listener to listen for page visibility changes
document.addEventListener("visibilitychange", event => {
    // If the page is now visible and the websocket is not open, open it
    if (document.visibilityState == "visible") {
        // Set the visible variable to true
        visible = true;

        // Clear the timer if it is set
        if (timer != 0) {
            clearTimeout(timer);
        }

        // Check whether the websocket is open, if not open it
        checkSocketAndSendMessage(event);
    }
    else {
        // Set the visible variable to false
        visible = false;

        // Clear the timer if it is set
        if (timer != 0) {
            clearTimeout(timer);
        }
    }
});

function setProgressBarVisible(isVisible) {
    progressWrapperElement = document.querySelector(".conversion-progress");

    if (progressWrapperElement == null) {
        return;
    }

    progressWrapperElement.style.display = isVisible ? "flex" : "none";
}

function initializeConverterScaffold() {
    initializeCurrentConversionScaffold();
    initializeStatisticsScaffold();
    initializeFilesScaffold();
    setProgressBarVisible(false);
}

function initializeCurrentConversionScaffold() {
    progressElement = document.getElementById("progress-details");

    if (progressElement == null) {
        return;
    }

    renderNoFileBeingConverted(progressElement);
}

function initializeStatisticsScaffold() {
    statisticsElement = document.getElementById("statistics");

    if (statisticsElement == null) {
        return;
    }

    if (document.getElementById("total_files-value") != null) {
        return;
    }

    statisticsElement.innerHTML = "";

    for (field of statisticsScaffoldFields) {
        appendKeyValueElement(statisticsElement, field.label, "--", [], [], field.key);
    }
}

function initializeFilesScaffold() {
    filesContainer = document.getElementById("converted-files");
    lastDayCount = document.getElementById("last-day-count");

    if (filesContainer == null || lastDayCount == null) {
        return;
    }

    if (filesContainer.childElementCount > 0) {
        return;
    }

    filesContainer.innerHTML = "";
    lastDayCount.innerText = "--";

    placeholderCount = 3;
    for (i = 0; i < placeholderCount; i++) {
        if (filesViewMode === 'files_to_convert') {
            appendToConvertFileCard(filesContainer, {
                filename: "Waiting for data...",
                prediction_confidence: "Low",
                current_size: "--",
                estimated_size_after_conversion: "--",
                estimated_percentage_saved: null,
                video_duration: "--",
                bit_rate: "--",
                video_codec: "--",
                audio_codec: "--"
            });
        } else {
            appendConvertedFileCard(filesContainer, {
                filename: "Waiting for data...",
                percentage_saved: 0,
                pre_conversion_size: "--",
                current_size: "--",
                start_conversion_time: "--",
                end_conversion_time: "--",
                total_conversion_time: "--"
            });
        }
    }
}

function formatStatisticsValue(field, statistics) {
    if (statistics == null || statistics[field.key] == null) {
        return "--";
    }

    value = statistics[field.key];

    if (field.type === 'size') {
        return formatSizeForDisplay(value, "GB");
    }

    if (field.type === 'percentage') {
        return value + "%";
    }

    return value;
}

function updateStatisticsValues(statistics) {
    initializeStatisticsScaffold();

    for (field of statisticsScaffoldFields) {
        setValueIfChanged(field.key + "-value", String(formatStatisticsValue(field, statistics)));
    }

    existingErrorsRow = document.getElementById("conversion-errors-row");
    if (statistics != null && statistics.conversion_errors > 0) {
        if (existingErrorsRow == null) {
            appendConversionErrorsRow(document.getElementById("statistics"), statistics.conversion_errors);
        } else {
            setValueIfChanged("conversion-errors-text", "Conversion Errors: " + statistics.conversion_errors);
        }
    } else if (existingErrorsRow != null) {
        existingErrorsRow.remove();
    }
}

// Function to open a web socket
function openWebSocket() {
    if (url == null || url.length == 0) {
        return;
    }

    if (ws != null && (ws.readyState == WebSocket.OPEN || ws.readyState == WebSocket.CONNECTING)) {
        return;
    }

    if (reconnectTimer != 0) {
        clearTimeout(reconnectTimer);
        reconnectTimer = 0;
    }

    console.log("Opening Websocket")
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for close/error events
    ws.onclose = event => {
        console.log("Websocket closed", event.code, event.reason);

        if (timer != 0) {
            clearTimeout(timer);
            timer = 0;
        }

        ws = null;

        if (visible) {
            scheduleReconnect("socket-closed");
        }
    };

    ws.onerror = event => {
        console.log("Websocket error", event);

        // Ensure broken sockets progress to onclose so reconnect logic runs.
        if (ws != null && ws.readyState == WebSocket.OPEN) {
            ws.close();
        }
    };

    // Setup callback for onmessage event
    ws.onmessage = event => {
        lastMessageTimestamp = Date.now();

        // Parse the message into a json object
        message = JSON.parse(event.data);

        switch (message.messageType) {
            case 'converting_files':
                // Get the conversion status
                conversionStatus = message.messageBody;

                // Get the progress element
                progressElement = document.getElementById("progress-details");

                // Get the number of files being converted
                numFiles = conversionStatus.converting_files.length;

                // Check whether the conversion number is greater than the number of files being converted
                if (conversionNumber >= numFiles) {
                    // Set the conversion number to the number of files being converted minus 1
                    conversionNumber = numFiles - 1;

                    // If the conversion number is less than 0, set it to 0
                    if (conversionNumber < 0) {
                        conversionNumber = 0;
                    }
                }

                // Get a list of the new tab names from the backend names
                newTabNames = conversionStatus.converting_files.map(file => file.backend_name);

                // If the array of new tab names is not equal to the array of current tab names, update the tabs
                if (newTabNames.toString() != currentTabNames.toString()) {
                    // Add a clickable element with the conversion number to the conversion-header element
                    conversionHeaderElement = document.getElementById("conversion-header");

                    // Remove all child elements from the conversion header element
                    while (conversionHeaderElement.firstChild) {
                        conversionHeaderElement.removeChild(conversionHeaderElement.firstChild);
                    }

                    // Loop through the files being converted
                    for (i = 0; i < numFiles; i++) {
                        // Create a new element
                        newElement = document.createElement("button");

                        // Set the id of the new element
                        newElement.id = "conversion-" + (i);

                        // Set the class of the new element
                        newElement.className = "conversion-button";

                        // Set the onclick function of the new element
                        newElement.onclick = function() { 
                            // Set the conversion number to the number at the end of the id
                            conversionNumber = this.id.match(/[0-9]+/g)[0];

                            // Clear the timer if it is set
                            if (timer != 0) {
                                clearTimeout(timer);
                            }

                            // Check whether the websocket is open, if not open it
                            checkSocketAndSendMessage(event);
                        };

                        // CHeck whether the backend name is null
                        if (conversionStatus.converting_files[i].backend_name == null) {
                            // Set the text of the new element
                            newElement.innerHTML = "File " + (i + 1);
                        } else {
                            // Set the text of the new element
                            newElement.innerHTML = conversionStatus.converting_files[i].backend_name;
                        }

                        // Append the new element to the conversion header element
                        conversionHeaderElement.appendChild(newElement);
                    }

                    // Set the current tab names to the new tab names
                    currentTabNames = newTabNames;
                }

                // Set all tabs to inactive
                for (i = 0; i < numFiles; i++) {
                    document.getElementById("conversion-" + i).className = "conversion-button";
                }

                // Only show the conversion data if numFiles is greater than 0
                if (numFiles > 0) {
                        setProgressBarVisible(true);

                    // Set the active tab to the conversion number
                    document.getElementById("conversion-" + conversionNumber).className = "conversion-button active";
    
                    // Parse the time remaining which is in Python timedelta string format into a Date object 
                    time_array = conversionStatus.converting_files[conversionNumber].time_remaining.match(/[0-9]+/g);

                    // Check that the time array is not null
                    if (time_array == null) {
                        days = 0;
                        hours = 0;
                        minutes = 0;
                        seconds = 0;
                    } else if (time_array.length == 4) {
                        days = parseInt(time_array[0]);
                        hours = parseInt(time_array[1]);
                        minutes = parseInt(time_array[2]);
                        seconds = parseInt(time_array[3]);
                    } else if (time_array.length == 3) {
                        days = 0;
                        hours = parseInt(time_array[0]);
                        minutes = parseInt(time_array[1]);
                        seconds = parseInt(time_array[2]);
                    } else {
                        console.log("Unknown time array length: " + time_array.length);
                        days = 0;
                        hours = 0;
                        minutes = 0;
                        seconds = 0;
                    }

                    // Create a new Date object which is the current time plus the time remaining
                    expected_completion_time = new Date();
                    expected_completion_time.setDate(expected_completion_time.getDate() + days);
                    expected_completion_time.setHours(expected_completion_time.getHours() + hours);
                    expected_completion_time.setMinutes(expected_completion_time.getMinutes() + minutes);
                    expected_completion_time.setSeconds(expected_completion_time.getSeconds() + seconds);

                    // Format the expected completion time into a string with the format %A HH:MM
                    expected_completion_time = expected_completion_time.toLocaleString('en-GB', {weekday: 'long', hour12: false, hour: '2-digit', minute: '2-digit'});

                    completeString = conversionStatus.converting_files[conversionNumber].progress.toFixed(2) + "%";

                    if (conversionStatus.converting_files[conversionNumber].copying) {
                        completeString = completeString + " (Copying)";
                    }

                    updateCurrentConversionDetails(
                        progressElement,
                        conversionStatus.converting_files[conversionNumber],
                        completeString,
                        expected_completion_time
                    );

                    // Set the value of the file-progress element to the progress
                    document.getElementById("file-progress").value = conversionStatus.converting_files[conversionNumber].progress;
                } else {
                        setProgressBarVisible(false);

                    renderNoFileBeingConverted(progressElement);

                    // Set the value of the file-progress element to 0
                    document.getElementById("file-progress").value = 0;
                }

                // Check whether the page is visible
                if (visible) {
                    // Clear the timer if it is set
                    if (timer != 0) {
                        clearTimeout(timer);
                    }

                    // Can call checkSocketAndSendMessage here, now the statistics message has been received and the server has responded
                    timer = setTimeout(checkSocketAndSendMessage, 1000);
                }

                break;
            case 'converted_files':
                // Get the files converted
                filesConverted = message.messageBody;

                cachedConvertedFiles = filesConverted;

                if (filesViewMode === 'converted_files') {
                    renderConvertedFiles(cachedConvertedFiles);
                }
                break;
            case 'files_to_convert':
                filesToConvert = message.messageBody;

                cachedFilesToConvert = filesToConvert;

                if (filesViewMode === 'files_to_convert') {
                    renderFilesToConvert(cachedFilesToConvert);
                }
                break;
            case 'statistics':
                // Get the statistics
                statistics = message.messageBody;

                updateStatisticsValues(statistics);
                break;
            default:
                console.log("Unknown message type received: " + event.data.messageType);

            
        }
    };

    // Add the event listener
    ws.addEventListener('open', (event) => {
        reconnectAttempt = 0;
        lastMessageTimestamp = Date.now();

        ws.send(JSON.stringify({
            messageType: 'set_files_view',
            view: filesViewMode
        }));

        checkSocketAndSendMessage(event);
    });
};

function checkSocketAndSendMessage(event) {
    // Send the messsage, checking that the socket is open
    if (ws != null && ws.readyState == WebSocket.OPEN) {
        // If the socket is open send the message
        sendMessage(event);
    } else if (ws == null || ws.readyState != WebSocket.CONNECTING) {
        // If the socket is not open or connecting, open a new socket
        scheduleReconnect("check-socket");
    }
};

function sendMessage(event) {
    // Create the message
    msg = {
        messageType: 'ping'
    };

    // Convert the JSON to a string and send it to the server
    try {
        if (ws != null && ws.readyState == WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
            lastPingTimestamp = Date.now();
        }
    } catch (error) {
        console.log("Websocket send failed", error);
        forceReconnect("send-failed");
    }
};

function scheduleReconnect(reason, immediate = false) {
    if (!visible) {
        return;
    }

    if (reconnectTimer != 0) {
        return;
    }

    if (navigator.onLine === false) {
        return;
    }

    baseDelayMs = immediate ? 0 : Math.min(1000 * Math.pow(2, reconnectAttempt), 12000);
    jitterMs = Math.floor(Math.random() * 400);
    reconnectDelayMs = baseDelayMs + jitterMs;

    reconnectAttempt = reconnectAttempt + 1;
    console.log("Scheduling websocket reconnect:", reason, reconnectDelayMs + "ms");

    reconnectTimer = setTimeout(() => {
        reconnectTimer = 0;
        openWebSocket();
    }, reconnectDelayMs);
}

function forceReconnect(reason) {
    console.log("Force websocket reconnect:", reason);

    if (ws != null) {
        try {
            ws.close();
        } catch (error) {
            console.log("Websocket close failed", error);
        }
    }

    ws = null;
    scheduleReconnect(reason, true);
}

function startConnectionWatchdog() {
    if (watchdogTimer != 0) {
        return;
    }

    watchdogTimer = setInterval(() => {
        if (!visible) {
            return;
        }

        if (navigator.onLine === false) {
            return;
        }

        if (ws == null || ws.readyState == WebSocket.CLOSED) {
            scheduleReconnect("watchdog-closed", true);
            return;
        }

        if (ws.readyState != WebSocket.OPEN) {
            return;
        }

        nowMs = Date.now();

        if (lastMessageTimestamp > 0 && nowMs - lastMessageTimestamp > staleConnectionMs) {
            forceReconnect("watchdog-stale");
            return;
        }

        if (nowMs - lastPingTimestamp > minPingIntervalMs) {
            checkSocketAndSendMessage();
        }
    }, watchdogIntervalMs);
}

function setupNetworkListeners() {
    window.addEventListener("online", () => {
        console.log("Network online");
        scheduleReconnect("browser-online", true);
    });

    window.addEventListener("offline", () => {
        console.log("Network offline");

        if (timer != 0) {
            clearTimeout(timer);
            timer = 0;
        }
    });
}

function setValueIfChanged(elementId, value) {
    element = document.getElementById(elementId);

    if (element == null) {
        return;
    }

    if (element.innerText !== value) {
        element.innerText = value;
    }
}

function renderNoFileBeingConverted(progressElement) {
    if (progressElement == null) {
        return;
    }

    progressElement.innerHTML = "";

    emptyStateElement = document.createElement("div");
    emptyStateElement.classList.add("current-empty-state");
    emptyStateElement.innerText = "No file being converted";

    progressElement.appendChild(emptyStateElement);
}

function updateCurrentConversionDetails(progressElement, fileData, completeString, expectedCompletionTime) {
    ensureCurrentConversionLayout(progressElement);

    filenameElement = document.getElementById("filename-value");
    if (filenameElement != null) {
        updateFilenamePopupText(filenameElement, fileData.filename);
    }

    setValueIfChanged("complete-value", completeString);
    setValueIfChanged("speed-value", fileData.speed != null ? fileData.speed : "--");
    setValueIfChanged("time_since_start-value", fileData.time_since_start);
    setValueIfChanged("time_remaining-value", fileData.time_remaining);
    setValueIfChanged("completion_time-value", expectedCompletionTime);
}

function ensureCurrentConversionLayout(progressElement) {
    // Build the modern panel layout once, then update values in place.
    if (document.getElementById("current-conversion-layout") != null) {
        return;
    }

    progressElement.innerHTML = "";

    layoutElement = document.createElement("div");
    layoutElement.id = "current-conversion-layout";
    layoutElement.classList.add("current-conversion-layout");

    filenameRowElement = document.createElement("div");
    filenameRowElement.classList.add("current-filename-row");
    filenameValueElement = document.createElement("div");
    filenameValueElement.id = "filename-value";
    filenameValueElement.classList.add("filename");
    filenameRowElement.appendChild(filenameValueElement);
    layoutElement.appendChild(filenameRowElement);

    completeSpeedRowElement = document.createElement("div");
    completeSpeedRowElement.classList.add("current-stats-row", "current-stats-row-two");
    completeSpeedRowElement.appendChild(createCurrentMetricBlock("complete", "Complete"));
    completeSpeedRowElement.appendChild(createCurrentMetricBlock("speed", "Speed"));
    layoutElement.appendChild(completeSpeedRowElement);

    timeRowElement = document.createElement("div");
    timeRowElement.classList.add("current-stats-row", "current-stats-row-three");
    timeRowElement.appendChild(createCurrentMetricBlock("time_since_start", "Since Start"));
    timeRowElement.appendChild(createCurrentMetricBlock("time_remaining", "Remaining"));
    timeRowElement.appendChild(createCurrentMetricBlock("completion_time", "Completion"));
    layoutElement.appendChild(timeRowElement);

    progressElement.appendChild(layoutElement);
    enableFilenamePopup(filenameRowElement, "No file being converted");
}

function createCurrentMetricBlock(idPrefix, label) {
    metricElement = document.createElement("div");
    metricElement.classList.add("current-metric-card");

    labelElement = document.createElement("div");
    labelElement.id = idPrefix + "-key";
    labelElement.classList.add("current-metric-label");
    labelElement.innerText = label;
    metricElement.appendChild(labelElement);

    valueElement = document.createElement("div");
    valueElement.id = idPrefix + "-value";
    valueElement.classList.add("current-metric-value");
    valueElement.innerText = "--";
    metricElement.appendChild(valueElement);

    return metricElement;
}

function appendConversionErrorsRow(element, errorCount) {
    rowElement = document.createElement("div");
    rowElement.classList.add("conversion-errors-card");
    rowElement.id = "conversion-errors-row";

    textElement = document.createElement("div");
    textElement.classList.add("conversion-errors-text");
    textElement.id = "conversion-errors-text";
    textElement.innerText = "Conversion Errors: " + errorCount;
    rowElement.appendChild(textElement);

    retryButton = document.createElement("button");
    retryButton.className = "retry-button";
    retryButton.innerText = "Retry";
    retryButton.onclick = function() {
        msg = {
            messageType: 'retry'
        };

        ws.send(JSON.stringify(msg));
    };

    rowElement.appendChild(retryButton);
    element.appendChild(rowElement);
}

function initializeFilesViewButtons() {
    convertedButton = document.getElementById("show-converted-files");
    toConvertButton = document.getElementById("show-to-convert-files");

    if (convertedButton == null || toConvertButton == null) {
        return;
    }

    convertedButton.onclick = function() {
        setFilesViewMode('converted_files');
    };

    toConvertButton.onclick = function() {
        setFilesViewMode('files_to_convert');
    };

    setFilesViewMode(filesViewMode, true);
}

function setFilesViewMode(viewMode, forceUpdate = false) {
    if (filesViewMode === viewMode && !forceUpdate) {
        return;
    }

    filesViewMode = viewMode;
    persistFilesViewMode(viewMode);

    convertedButton = document.getElementById("show-converted-files");
    toConvertButton = document.getElementById("show-to-convert-files");
    filesViewTitle = document.getElementById("files-view-title");
    if (convertedButton != null && toConvertButton != null) {
        convertedButton.classList.toggle("active", viewMode === 'converted_files');
        toConvertButton.classList.toggle("active", viewMode === 'files_to_convert');
    }

    if (filesViewTitle != null) {
        if (viewMode === 'files_to_convert') {
            filesViewTitle.innerText = "Files To Be Converted";
        } else {
            filesViewTitle.innerText = "Files Converted in Last Week";
        }
    }

    if (viewMode === 'files_to_convert' && cachedFilesToConvert != null) {
        renderFilesToConvert(cachedFilesToConvert);
    } else if (viewMode === 'converted_files' && cachedConvertedFiles != null) {
        renderConvertedFiles(cachedConvertedFiles);
    }

    if (ws != null && ws.readyState == WebSocket.OPEN) {
        ws.send(JSON.stringify({
            messageType: 'set_files_view',
            view: viewMode
        }));

        checkSocketAndSendMessage();
    }
}

function getStoredFilesViewMode() {
    try {
        storedMode = localStorage.getItem(filesViewStorageKey);
    } catch (error) {
        return 'converted_files';
    }

    if (storedMode === 'files_to_convert') {
        return 'files_to_convert';
    }

    return 'converted_files';
}

function persistFilesViewMode(viewMode) {
    try {
        localStorage.setItem(filesViewStorageKey, viewMode);
    } catch (error) {
        // Ignore storage write failures.
    }
}

function renderConvertedFiles(filesConverted) {
    filesContainer = document.getElementById("converted-files");
    lastDayCount = document.getElementById("last-day-count");

    if (filesContainer == null || lastDayCount == null) {
        return;
    }

    if (filesConverted == null) {
        initializeFilesScaffold();
        return;
    }

    filesContainer.innerText = "";
    lastDayCount.innerText = filesConverted.converted_files.length;

    for (i = 0; i < filesConverted.converted_files.length; i++) {
        appendConvertedFileCard(filesContainer, filesConverted.converted_files[i]);
    }
}

function renderFilesToConvert(filesToConvert) {
    filesContainer = document.getElementById("converted-files");
    lastDayCount = document.getElementById("last-day-count");

    if (filesContainer == null || lastDayCount == null) {
        return;
    }

    if (filesToConvert == null) {
        initializeFilesScaffold();
        return;
    }

    filesContainer.innerText = "";
    lastDayCount.innerText = filesToConvert.files_to_convert.length;

    for (i = 0; i < filesToConvert.files_to_convert.length; i++) {
        appendToConvertFileCard(filesContainer, filesToConvert.files_to_convert[i]);
    }
}
