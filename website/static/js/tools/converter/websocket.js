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
const sessionConvertedStorageKey = 'converter.session.convertedFiles';
const sessionQueueStorageKey = 'converter.session.filesToConvert';
const sessionStatisticsStorageKey = 'converter.session.statistics';

// Track which cards are shown in the lower panel.
var filesViewMode = getStoredFilesViewMode();

// Cache the latest payload for each lower-card view to avoid flicker on toggle.
var cachedConvertedFiles = null;
var cachedFilesToConvert = null;
var cachedStatistics = null;
var statisticsMounted = false;

const statisticsScaffoldFields = [
    { key: 'total_files', label: 'Total files', type: 'number', wrapperClass: [] },
    { key: 'total_converted', label: 'Converted', type: 'number', wrapperClass: ['kpi-live'] },
    { key: 'total_to_convert', label: 'In queue', type: 'number', wrapperClass: ['kpi-queue'] },
    { key: 'total_conversion_time', label: 'Total time', type: 'text', wrapperClass: [] },
    { key: 'films_converted', label: 'Films converted', type: 'number', wrapperClass: [] },
    { key: 'films_to_convert', label: 'Films in queue', type: 'number', wrapperClass: ['kpi-queue'] },
    { key: 'tv_converted', label: 'TV converted', type: 'number', wrapperClass: [] },
    { key: 'tv_to_convert', label: 'TV in queue', type: 'number', wrapperClass: ['kpi-queue'] },
    { key: 'converted_media_mix', label: 'Converted mix', type: 'text', wrapperClass: ['kpi-mix'] },
    { key: 'queue_media_mix', label: 'Queue mix', type: 'text', wrapperClass: ['kpi-mix', 'kpi-queue'] },
    { key: 'gigabytes_before_conversion', label: 'Size before', type: 'size', wrapperClass: [] },
    { key: 'gigabytes_after_conversion', label: 'Size after', type: 'size', wrapperClass: [] },
    { key: 'gigabytes_saved', label: 'Space saved', type: 'size', wrapperClass: ['kpi-emphasis'] },
    { key: 'percentage_saved', label: 'Saved', type: 'percentage', wrapperClass: ['kpi-emphasis'] }
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

        initializeConverterScaffold();
        initializeFilesViewButtons();
        initializeOverviewDialog();
        setupNetworkListeners();
        startConnectionWatchdog();

        // Check whether the websocket is open, if not open it
        openWebSocket();
    }
});

// Add an event listener to listen for page visibility changes
document.addEventListener("visibilitychange", () => {
    // If the page is now visible and the websocket is not open, open it
    if (document.visibilityState == "visible") {
        // Set the visible variable to true
        visible = true;

        // Clear the timer if it is set
        if (timer != 0) {
            clearTimeout(timer);
        }

        // Check whether the websocket is open, if not open it
        checkSocketAndSendMessage();
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
    const progressWrapperElement = document.querySelector(".live-progress");

    if (progressWrapperElement == null) {
        return;
    }

    progressWrapperElement.style.display = isVisible ? "flex" : "none";
}

function setLiveStageVisible(isVisible) {
    const liveStageElement = document.querySelector(".live-stage");

    if (liveStageElement == null) {
        return;
    }

    liveStageElement.hidden = !isVisible;
}

function initializeConverterScaffold() {
    initializeCurrentConversionScaffold();
    setProgressBarVisible(false);
    setLiveStageVisible(false);
    restoreSessionCaches();
    paintActivityFromCacheOrStatus();
}

function initializeOverviewDialog() {
    const dialog = document.getElementById("overview-dialog");
    const openButton = document.getElementById("overview-button");
    const closeButton = document.getElementById("overview-dialog-close");

    if (dialog == null || openButton == null) {
        return;
    }

    if (openButton.dataset.overviewBound === "true") {
        return;
    }

    openButton.dataset.overviewBound = "true";

    function setExpanded(isOpen) {
        openButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    openButton.addEventListener("click", function() {
        ensureOverviewContent();
        if (typeof dialog.showModal === "function") {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }
        setExpanded(true);
    });

    if (closeButton != null) {
        closeButton.addEventListener("click", function() {
            dialog.close();
        });
    }

    dialog.addEventListener("click", function(event) {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener("close", function() {
        setExpanded(false);
    });
}

function ensureOverviewContent() {
    if (cachedStatistics != null) {
        mountStatisticsScaffold();
        fillStatisticsValues(cachedStatistics);
        setOverviewStatus(null);
        return;
    }

    setOverviewStatus("Connecting…");
}

function initializeCurrentConversionScaffold() {
    const progressElement = document.getElementById("progress-details");

    if (progressElement == null) {
        return;
    }

    renderNoFileBeingConverted(progressElement);
}

function mountStatisticsScaffold() {
    const statisticsElement = document.getElementById("statistics");

    if (statisticsElement == null) {
        return;
    }

    if (statisticsMounted && document.getElementById("total_files-value") != null) {
        return;
    }

    statisticsElement.innerHTML = "";

    for (const field of statisticsScaffoldFields) {
        appendKeyValueElement(
            statisticsElement,
            field.label,
            "--",
            [],
            [],
            field.key,
            field.wrapperClass || []
        );
    }

    statisticsMounted = true;
}

function setActivityStatus(message) {
    const statusElement = document.getElementById("activity-status");
    const filesContainer = document.getElementById("converted-files");

    if (statusElement == null) {
        return;
    }

    if (message == null || message.length === 0) {
        statusElement.hidden = true;
        statusElement.textContent = "";
        return;
    }

    if (filesContainer != null) {
        filesContainer.innerHTML = "";
    }

    statusElement.textContent = message;
    statusElement.hidden = false;
}

function setOverviewStatus(message) {
    const statusElement = document.getElementById("overview-status");
    const statisticsElement = document.getElementById("statistics");

    if (statusElement == null) {
        return;
    }

    if (message == null || message.length === 0) {
        statusElement.hidden = true;
        statusElement.textContent = "";
        if (statisticsElement != null) {
            statisticsElement.hidden = !statisticsMounted;
        }
        return;
    }

    statusElement.textContent = message;
    statusElement.hidden = false;
    if (statisticsElement != null) {
        statisticsElement.hidden = true;
    }
}

function setCountPill(value) {
    const lastDayCount = document.getElementById("last-day-count");
    if (lastDayCount != null) {
        lastDayCount.innerText = String(value);
    }
}

function paintActivityFromCacheOrStatus() {
    if (filesViewMode === 'files_to_convert') {
        if (cachedFilesToConvert != null) {
            renderFilesToConvert(cachedFilesToConvert, false);
            return;
        }
    } else if (cachedConvertedFiles != null) {
        renderConvertedFiles(cachedConvertedFiles, false);
        return;
    }

    setCountPill("--");
    setActivityStatus("Connecting…");
}

function restoreSessionCaches() {
    cachedConvertedFiles = readSessionJson(sessionConvertedStorageKey);
    cachedFilesToConvert = readSessionJson(sessionQueueStorageKey);
    cachedStatistics = readSessionJson(sessionStatisticsStorageKey);
}

function readSessionJson(storageKey) {
    try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw == null || raw.length === 0) {
            return null;
        }
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function writeSessionJson(storageKey, value) {
    try {
        if (value == null) {
            sessionStorage.removeItem(storageKey);
            return;
        }
        sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
        // Ignore quota / private-mode write failures.
    }
}

function formatStatisticsValue(field, statistics) {
    if (statistics == null || statistics[field.key] == null) {
        return "--";
    }

    const value = statistics[field.key];

    if (field.type === 'size') {
        return formatSizeForDisplay(value, "GB");
    }

    if (field.type === 'percentage') {
        return value + "%";
    }

    return value;
}

function fillStatisticsValues(statistics) {
    for (const field of statisticsScaffoldFields) {
        setValueIfChanged(field.key + "-value", String(formatStatisticsValue(field, statistics)));
    }

    const existingErrorsRow = document.getElementById("conversion-errors-row");
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

function updateStatisticsValues(statistics) {
    cachedStatistics = statistics;
    writeSessionJson(sessionStatisticsStorageKey, statistics);

    const dialog = document.getElementById("overview-dialog");
    const overviewIsOpen = dialog != null && dialog.open === true;

    if (!statisticsMounted && !overviewIsOpen) {
        return;
    }

    mountStatisticsScaffold();
    fillStatisticsValues(statistics);
    setOverviewStatus(null);
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
        const message = JSON.parse(event.data);

        switch (message.messageType) {
            case 'converting_files':
                // Get the conversion status
                const conversionStatus = message.messageBody;

                // Get the progress element
                const progressElement = document.getElementById("progress-details");

                // Get the number of files being converted
                const numFiles = conversionStatus.converting_files.length;

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
                const newTabNames = conversionStatus.converting_files.map(file => file.backend_name);

                // If the array of new tab names is not equal to the array of current tab names, update the tabs
                if (newTabNames.toString() != currentTabNames.toString()) {
                    // Add a clickable element with the conversion number to the conversion-header element
                    const conversionHeaderElement = document.getElementById("conversion-header");

                    // Remove all child elements from the conversion header element
                    while (conversionHeaderElement.firstChild) {
                        conversionHeaderElement.removeChild(conversionHeaderElement.firstChild);
                    }

                    // Loop through the files being converted
                    for (let i = 0; i < numFiles; i++) {
                        // Create a new element
                        const newElement = document.createElement("button");

                        // Set the id of the new element
                        newElement.id = "conversion-" + (i);

                        // Set the class of the new element
                        newElement.className = "conversion-button";

                        // Set the onclick function of the new element
                        newElement.onclick = function() { 
                            // Set the conversion number to the number at the end of the id
                            conversionNumber = Number(this.id.match(/[0-9]+/g)[0]);

                            // Clear the timer if it is set
                            if (timer != 0) {
                                clearTimeout(timer);
                            }

                            // Check whether the websocket is open, if not open it
                            checkSocketAndSendMessage();
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
                for (let i = 0; i < numFiles; i++) {
                    document.getElementById("conversion-" + i).className = "conversion-button";
                }

                // Only show the conversion data if numFiles is greater than 0
                if (numFiles > 0) {
                    setLiveStageVisible(true);
                    setProgressBarVisible(true);

                    // Set the active tab to the conversion number
                    document.getElementById("conversion-" + conversionNumber).className = "conversion-button active";
    
                    // Parse the time remaining which is in Python timedelta string format into a Date object 
                    const timeArray = conversionStatus.converting_files[conversionNumber].time_remaining.match(/[0-9]+/g);

                    let days = 0;
                    let hours = 0;
                    let minutes = 0;
                    let seconds = 0;

                    // Check that the time array is not null
                    if (timeArray == null) {
                        days = 0;
                        hours = 0;
                        minutes = 0;
                        seconds = 0;
                    } else if (timeArray.length == 4) {
                        days = parseInt(timeArray[0], 10);
                        hours = parseInt(timeArray[1], 10);
                        minutes = parseInt(timeArray[2], 10);
                        seconds = parseInt(timeArray[3], 10);
                    } else if (timeArray.length == 3) {
                        days = 0;
                        hours = parseInt(timeArray[0], 10);
                        minutes = parseInt(timeArray[1], 10);
                        seconds = parseInt(timeArray[2], 10);
                    } else {
                        console.log("Unknown time array length: " + timeArray.length);
                        days = 0;
                        hours = 0;
                        minutes = 0;
                        seconds = 0;
                    }

                    // Create a new Date object which is the current time plus the time remaining
                    const expectedCompletionTime = new Date();
                    expectedCompletionTime.setDate(expectedCompletionTime.getDate() + days);
                    expectedCompletionTime.setHours(expectedCompletionTime.getHours() + hours);
                    expectedCompletionTime.setMinutes(expectedCompletionTime.getMinutes() + minutes);
                    expectedCompletionTime.setSeconds(expectedCompletionTime.getSeconds() + seconds);

                    // Format the expected completion time into a string with the format %a HH:MM
                    const expectedCompletionTimeString = expectedCompletionTime.toLocaleString('en-GB', { weekday: 'short', hour12: false, hour: '2-digit', minute: '2-digit' });

                    let completeString = conversionStatus.converting_files[conversionNumber].progress.toFixed(2) + "%";

                    updateCurrentConversionDetails(
                        progressElement,
                        conversionStatus.converting_files[conversionNumber],
                        completeString,
                        expectedCompletionTimeString
                    );

                    // Set the value of the file-progress element to the progress
                    document.getElementById("file-progress").value = conversionStatus.converting_files[conversionNumber].progress;
                } else {
                    setProgressBarVisible(false);
                    setLiveStageVisible(false);
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
                const filesConverted = message.messageBody;

                cachedConvertedFiles = filesConverted;

                if (filesViewMode === 'converted_files') {
                    renderConvertedFiles(cachedConvertedFiles);
                }
                break;
            case 'files_to_convert':
                const filesToConvert = message.messageBody;

                cachedFilesToConvert = filesToConvert;

                if (filesViewMode === 'files_to_convert') {
                    renderFilesToConvert(cachedFilesToConvert);
                }
                break;
            case 'statistics':
                // Get the statistics
                const statistics = message.messageBody;

                updateStatisticsValues(statistics);
                break;
            default:
                console.log("Unknown message type received: " + event.data.messageType);

            
        }
    };

    // Add the event listener
    ws.addEventListener('open', () => {
        reconnectAttempt = 0;
        lastMessageTimestamp = Date.now();

        ws.send(JSON.stringify({
            messageType: 'set_files_view',
            view: filesViewMode
        }));

        checkSocketAndSendMessage();
    });
};

function checkSocketAndSendMessage() {
    // Send the messsage, checking that the socket is open
    if (ws != null && ws.readyState == WebSocket.OPEN) {
        // If the socket is open send the message
        sendMessage();
    } else if (ws == null || ws.readyState != WebSocket.CONNECTING) {
        // If the socket is not open or connecting, open a new socket
        scheduleReconnect("check-socket");
    }
};

function sendMessage() {
    // Create the message
    const msg = {
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

    const baseDelayMs = immediate ? 0 : Math.min(1000 * Math.pow(2, reconnectAttempt), 12000);
    const jitterMs = Math.floor(Math.random() * 400);
    const reconnectDelayMs = baseDelayMs + jitterMs;

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

        const nowMs = Date.now();

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
    const element = document.getElementById(elementId);

    if (element == null) {
        return;
    }

    if (element.innerText !== value) {
        element.innerText = value;
    }
}

function formatSpeedMultiplier(speedValue) {
    if (speedValue == null || speedValue === "") {
        return "--";
    }

    if (typeof speedValue === "number" && Number.isFinite(speedValue)) {
        return `${speedValue.toFixed(2)}x`;
    }

    const speedText = String(speedValue).trim();
    if (speedText.length === 0 || speedText === "--") {
        return "--";
    }

    const parsedSpeed = Number.parseFloat(speedText.replace(/x$/i, ""));
    if (!Number.isFinite(parsedSpeed)) {
        return speedText;
    }

    return `${parsedSpeed.toFixed(2)}x`;
}

function formatPredictedRatio(estimatedPercentageSaved) {
    if (estimatedPercentageSaved == null || estimatedPercentageSaved === "") {
        return "--";
    }

    const parsedRatio = Number.parseFloat(String(estimatedPercentageSaved));
    if (!Number.isFinite(parsedRatio)) {
        return "--";
    }

    return `${Math.round(parsedRatio).toFixed(0)}%`;
}

function getLivePredictedRatioValue(fileData) {
    if (fileData == null || typeof fileData !== "object") {
        return null;
    }

    if (fileData.estimated_percentage_saved != null) {
        return fileData.estimated_percentage_saved;
    }

    return null;
}

function renderNoFileBeingConverted(progressElement) {
    if (progressElement == null) {
        return;
    }

    progressElement.innerHTML = "";

    const emptyStateElement = document.createElement("div");
    emptyStateElement.classList.add("current-empty-state");
    emptyStateElement.innerText = "No file being converted";

    progressElement.appendChild(emptyStateElement);
}

function updateCurrentConversionDetails(progressElement, fileData, completeString, expectedCompletionTime) {
    ensureCurrentConversionLayout(progressElement);

    const filenameElement = document.getElementById("filename-value");
    if (filenameElement != null) {
        const displayTitle = fileData.display_title || fileData.filename;
        updateFilenamePopupText(filenameElement, displayTitle);
        if (fileData.filename && fileData.filename !== displayTitle) {
            filenameElement.dataset.fullFilename = fileData.filename;
        }
    }

    const posterElement = document.getElementById("live-poster-value");
    if (posterElement != null) {
        const nextSrc = fileData.cover_art_url || "/icons/tools/converter/art-placeholder.svg";
        posterElement.dataset.artStatus = fileData.cover_art_status || "pending";
        posterElement.dataset.artKey = fileData.cover_art_key || "";
        if (posterElement.getAttribute("src") !== nextSrc) {
            posterElement.setAttribute("src", nextSrc);
        }
        if (window.console && console.debug) {
            console.debug("[converter-art] live", {
                title: fileData.display_title || fileData.filename,
                key: fileData.cover_art_key,
                status: fileData.cover_art_status,
                url: fileData.cover_art_url
            });
        }
    }

    setValueIfChanged("complete-value", completeString);

    const phaseElement = document.getElementById("complete-phase");
    if (phaseElement != null) {
        const phaseText = Boolean(fileData.copying) ? "Copying" : "Converting";
        phaseElement.hidden = false;
        if (phaseElement.innerText !== phaseText) {
            phaseElement.innerText = phaseText;
        }
    }

    setValueIfChanged("speed-value", formatSpeedMultiplier(fileData.speed));
    setValueIfChanged("predicted_ratio-value", formatPredictedRatio(getLivePredictedRatioValue(fileData)));
    setValueIfChanged("time_since_start-value", fileData.time_since_start);
    setValueIfChanged("time_remaining-value", fileData.time_remaining);
    setValueIfChanged("completion_time-value", expectedCompletionTime);
}

function ensureCurrentConversionLayout(progressElement) {
    // Build the modern panel layout once, then update values in place.
    const existingLayout = document.getElementById("current-conversion-layout");
    if (existingLayout != null && document.getElementById("complete-phase") != null) {
        return;
    }

    progressElement.innerHTML = "";

    const layoutElement = document.createElement("div");
    layoutElement.id = "current-conversion-layout";
    layoutElement.classList.add("current-conversion-layout");

    const artElement = document.createElement("div");
    artElement.classList.add("live-art");
    layoutElement.appendChild(artElement);

    const posterElement = document.createElement("img");
    posterElement.id = "live-poster-value";
    posterElement.classList.add("live-poster");
    posterElement.alt = "";
    posterElement.decoding = "async";
    posterElement.src = "/icons/tools/converter/art-placeholder.svg";
    posterElement.addEventListener("error", function() {
        console.warn("[converter-art] live poster error", {
            key: posterElement.dataset.artKey,
            status: posterElement.dataset.artStatus,
            src: posterElement.getAttribute("src")
        });
        posterElement.dataset.artStatus = "img_error";
        posterElement.src = "/icons/tools/converter/art-placeholder.svg";
    });
    artElement.appendChild(posterElement);

    const mainElement = document.createElement("div");
    mainElement.classList.add("live-main");
    layoutElement.appendChild(mainElement);

    const filenameValueElement = document.createElement("div");
    filenameValueElement.id = "filename-value";
    filenameValueElement.classList.add("filename", "live-filename");
    mainElement.appendChild(filenameValueElement);

    const factsElement = document.createElement("div");
    factsElement.classList.add("file-row-facts", "live-facts");
    factsElement.appendChild(createLiveFact("speed", "Speed"));
    factsElement.appendChild(createLiveFact("predicted_ratio", "Est. save"));
    factsElement.appendChild(createLiveFact("time_since_start", "Elapsed"));
    factsElement.appendChild(createLiveFact("time_remaining", "Remaining"));
    factsElement.appendChild(createLiveFact("completion_time", "Done by"));
    mainElement.appendChild(factsElement);

    const heroElement = document.createElement("div");
    heroElement.classList.add("file-row-hero", "live-hero");
    layoutElement.appendChild(heroElement);

    const phaseElement = document.createElement("span");
    phaseElement.id = "complete-phase";
    phaseElement.classList.add("live-phase-note");
    phaseElement.innerText = "Converting";
    heroElement.appendChild(phaseElement);

    const heroValueElement = document.createElement("span");
    heroValueElement.id = "complete-value";
    heroValueElement.classList.add("file-row-hero-value");
    heroValueElement.innerText = "--";
    heroElement.appendChild(heroValueElement);

    const heroLabelElement = document.createElement("span");
    heroLabelElement.id = "complete-key";
    heroLabelElement.classList.add("file-row-hero-label");
    heroLabelElement.innerText = "complete";
    heroElement.appendChild(heroLabelElement);

    progressElement.appendChild(layoutElement);
    enableFilenamePopup(mainElement, "No file being converted");
}

function createLiveFact(idPrefix, label) {
    const factElement = document.createElement("span");
    factElement.classList.add("file-fact");

    const labelElement = document.createElement("span");
    labelElement.id = idPrefix + "-key";
    labelElement.classList.add("file-fact-label");
    labelElement.innerText = label;
    factElement.appendChild(labelElement);

    const valueElement = document.createElement("span");
    valueElement.id = idPrefix + "-value";
    valueElement.classList.add("file-fact-value");
    valueElement.innerText = "--";
    factElement.appendChild(valueElement);

    return factElement;
}

function appendConversionErrorsRow(element, errorCount) {
    const rowElement = document.createElement("div");
    rowElement.classList.add("conversion-errors-card");
    rowElement.id = "conversion-errors-row";

    const textElement = document.createElement("div");
    textElement.classList.add("conversion-errors-text");
    textElement.id = "conversion-errors-text";
    textElement.innerText = "Conversion Errors: " + errorCount;
    rowElement.appendChild(textElement);

    const retryButton = document.createElement("button");
    retryButton.className = "retry-button";
    retryButton.innerText = "Retry";
    retryButton.onclick = function() {
        const msg = {
            messageType: 'retry'
        };

        ws.send(JSON.stringify(msg));
    };

    rowElement.appendChild(retryButton);
    element.appendChild(rowElement);
}

function initializeFilesViewButtons() {
    const convertedButton = document.getElementById("show-converted-files");
    const toConvertButton = document.getElementById("show-to-convert-files");

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

    const convertedButton = document.getElementById("show-converted-files");
    const toConvertButton = document.getElementById("show-to-convert-files");
    const filesViewTitle = document.getElementById("files-view-title");
    if (convertedButton != null && toConvertButton != null) {
        convertedButton.classList.toggle("active", viewMode === 'converted_files');
        toConvertButton.classList.toggle("active", viewMode === 'files_to_convert');
    }

    if (filesViewTitle != null) {
        if (viewMode === 'files_to_convert') {
            filesViewTitle.innerText = "Waiting in queue";
        } else {
            filesViewTitle.innerText = "Converted this week";
        }
    }

    if (viewMode === 'files_to_convert') {
        if (cachedFilesToConvert != null) {
            renderFilesToConvert(cachedFilesToConvert, false);
        } else {
            setCountPill("--");
            setActivityStatus("Connecting…");
        }
    } else if (cachedConvertedFiles != null) {
        renderConvertedFiles(cachedConvertedFiles, false);
    } else {
        setCountPill("--");
        setActivityStatus("Connecting…");
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
        const storedMode = localStorage.getItem(filesViewStorageKey);

        if (storedMode === 'files_to_convert') {
            return 'files_to_convert';
        }
    } catch (error) {
        return 'converted_files';
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

function renderConvertedFiles(filesConverted, persist = true) {
    const filesContainer = document.getElementById("converted-files");

    if (filesContainer == null) {
        return;
    }

    if (filesConverted == null) {
        setCountPill("--");
        setActivityStatus("Connecting…");
        return;
    }

    if (persist) {
        writeSessionJson(sessionConvertedStorageKey, filesConverted);
    }

    const convertedFiles = filesConverted.converted_files || [];
    setCountPill(convertedFiles.length);

    if (convertedFiles.length === 0) {
        setActivityStatus("No conversions this week");
        return;
    }

    setActivityStatus(null);
    filesContainer.innerHTML = "";

    for (let i = 0; i < convertedFiles.length; i++) {
        appendConvertedFileCard(filesContainer, convertedFiles[i]);
    }
}

function renderFilesToConvert(filesToConvert, persist = true) {
    const filesContainer = document.getElementById("converted-files");

    if (filesContainer == null) {
        return;
    }

    if (filesToConvert == null) {
        setCountPill("--");
        setActivityStatus("Connecting…");
        return;
    }

    if (persist) {
        writeSessionJson(sessionQueueStorageKey, filesToConvert);
    }

    const queueFiles = filesToConvert.files_to_convert || [];
    setCountPill(queueFiles.length);

    if (queueFiles.length === 0) {
        setActivityStatus("Queue is empty");
        return;
    }

    setActivityStatus(null);
    filesContainer.innerHTML = "";

    for (let i = 0; i < queueFiles.length; i++) {
        appendToConvertFileCard(filesContainer, queueFiles[i]);
    }
}
