// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable to identify the timer in use
var timer = 0;

// Variable to identify whether the page is visible, set to true by default as the page is visible when it loads
var visible = true;

// Variable to store the conversion number
var conversionNumber = 0;

// An array to store the tab names
var currentTabNames = [];

// Track which cards are shown in the lower panel.
var filesViewMode = 'converted_files';

// Cache the latest payload for each lower-card view to avoid flicker on toggle.
var cachedConvertedFiles = null;
var cachedFilesToConvert = null;

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

// Function to open a web socket
function openWebSocket() {
    console.log("Opening Websocket")
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
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
                    // Show no file status when there is no active conversion
                    progressElement.innerHTML = '<div class="current-empty-state">No file being converted</div>';

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

                // Check whether statistics is null
                if (statistics == null) {
                    // Set the innerHTML of the statistics element to "No statistics"
                    document.getElementById("statistics").innerHTML = "No statistics";
                } else {
                    // Clear the statistics element
                    document.getElementById("statistics").innerHTML = "";

                    // Loop through the statistics
                    for ([key, value] of Object.entries(statistics)) {
                        switch (key) {
                            case 'total_files':
                                label = "Total Files: ";
                                break;
                            case 'total_converted':
                                label = "Total Files Converted: ";
                                break;
                            case 'total_to_convert':
                                label = "Total Files to Convert: ";
                                break;
                            case 'gigabytes_before_conversion':
                                label = "Size Before Conversion: ";
                                value = formatSizeForDisplay(value, "GB");
                                break;
                            case 'gigabytes_after_conversion':
                                label = "Size After Conversion: ";
                                value = formatSizeForDisplay(value, "GB");
                                break;
                            case 'gigabytes_saved':
                                label = "Space Saved: ";
                                value = formatSizeForDisplay(value, "GB");
                                break;
                            case 'percentage_saved':
                                label = "Percentage Saved: ";
                                value = value + "%";
                                break;
                            case 'total_conversion_time':
                                label = "Total Conversion Time: ";
                                break;
                            case 'total_size_before_conversion_tb':
                                continue;
                            case 'total_size_after_conversion_tb':
                                continue;
                            case 'films_converted':
                                continue;
                            case 'films_to_convert':
                                continue;
                            case 'conversion_errors':
                                // Render conversion errors separately as a dedicated full-width row.
                                continue;
                            case 'conversions_by_backend':
                                // Ignore this key, we will loop through the values later
                                continue;
                            default:
                                console.log("Unknown key: " + key);
                        }

                        // Create the statistics element
                        appendKeyValueElement(document.getElementById("statistics"), label, value, [], [], key);
                    }

                    // Show a dedicated conversion errors row only when there are errors.
                    if (statistics.conversion_errors > 0) {
                        appendConversionErrorsRow(
                            document.getElementById("statistics"),
                            statistics.conversion_errors
                        );
                    }
                }
                break;
            default:
                console.log("Unknown message type received: " + event.data.messageType);

            
        }
    };

    // Add the event listener
    ws.addEventListener('open', (event) => {
        ws.send(JSON.stringify({
            messageType: 'set_files_view',
            view: filesViewMode
        }));

        checkSocketAndSendMessage(event);
    });
};

function checkSocketAndSendMessage(event) {
    // Send the messsage, checking that the socket is open
    if (ws.readyState == WebSocket.OPEN) {
        // If the socket is open send the message
        sendMessage(event);
    } else if (ws.readyState != WebSocket.CONNECTING) {
        // If the socket is not open or connecting, open a new socket
        openWebSocket();
    }
};

function sendMessage(event) {
    // Create the message
    msg = {
        messageType: 'ping'
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(msg));
};

function setValueIfChanged(elementId, value) {
    element = document.getElementById(elementId);

    if (element == null) {
        return;
    }

    if (element.innerText !== value) {
        element.innerText = value;
    }
}

function updateCurrentConversionDetails(progressElement, fileData, completeString, expectedCompletionTime) {
    // Build the modern panel layout once, then update values in place.
    if (document.getElementById("current-conversion-layout") == null) {
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
        enableFilenamePopup(filenameRowElement, fileData.filename);
    }

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

    textElement = document.createElement("div");
    textElement.classList.add("conversion-errors-text");
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
}

function setFilesViewMode(viewMode) {
    if (filesViewMode === viewMode) {
        return;
    }

    filesViewMode = viewMode;

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

function renderConvertedFiles(filesConverted) {
    filesContainer = document.getElementById("converted-files");
    lastDayCount = document.getElementById("last-day-count");

    if (filesContainer == null || lastDayCount == null) {
        return;
    }

    if (filesConverted == null) {
        filesContainer.innerText = "No files converted";
        lastDayCount.innerText = "0";
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
        filesContainer.innerText = "No files to convert";
        lastDayCount.innerText = "0";
        return;
    }

    filesContainer.innerText = "";
    lastDayCount.innerText = filesToConvert.files_to_convert.length;

    for (i = 0; i < filesToConvert.files_to_convert.length; i++) {
        appendToConvertFileCard(filesContainer, filesToConvert.files_to_convert[i]);
    }
}
