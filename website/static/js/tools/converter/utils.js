function appendKeyValueElement(element, key, value, additionalKeyClass = [], additionalValueClass = [], id = "") {
    // Create wrapper element
    var wrapperElement = document.createElement("div");
    wrapperElement.classList.add("key-value-wrapper");

    // Create key element
    var keyElement = document.createElement("div");
    keyElement.classList.add("data-key");

    if (additionalKeyClass.length > 0) {
        keyElement.classList.add(...additionalKeyClass);
    }

    // Create value element
    var valueElement = document.createElement("div");
    valueElement.classList.add("data-value");

    if (id.length > 0) {
        keyElement.id = id + "-key";
        valueElement.id = id + "-value";
    }

    if (additionalValueClass.length > 0) {
        valueElement.classList.add(...additionalValueClass);
    }

    // Set key and value text
    keyElement.innerText = key;
    valueElement.innerText = value;

    // Append key and value elements as children of the wrapper
    wrapperElement.appendChild(keyElement);
    wrapperElement.appendChild(valueElement);

    // Append wrapper element as a child of the input element
    element.appendChild(wrapperElement);

    return wrapperElement;
}

function appendConvertedFileCard(element, data) {
    var cardElement = document.createElement("article");
    cardElement.classList.add("converted-file-card");

    var headerElement = document.createElement("div");
    headerElement.classList.add("converted-file-header");
    cardElement.appendChild(headerElement);

    var titleElement = document.createElement("h4");
    titleElement.classList.add("converted-file-name");
    titleElement.innerText = data.filename;
    headerElement.appendChild(titleElement);

    var badgeElement = document.createElement("span");
    badgeElement.classList.add("converted-file-badge");
    badgeElement.innerText = data.percentage_saved.toFixed(0) + "%";
    headerElement.appendChild(badgeElement);

    var detailsElement = document.createElement("div");
    detailsElement.classList.add("converted-file-details");
    cardElement.appendChild(detailsElement);

    appendCardStat(detailsElement, "Original", getCardValue(data.pre_conversion_size, "--", false, false, true));
    appendCardStat(detailsElement, "New", getCardValue(data.current_size, "--", false, false, true));
    appendCardStat(detailsElement, "Ratio", getCardValue(data.percentage_saved, "--", true));
    appendCardStat(detailsElement, "Start", getCardValue(data.start_conversion_time, "--", false, true));
    appendCardStat(detailsElement, "End", getCardValue(data.end_conversion_time, "--", false, true));
    appendCardStat(detailsElement, "Total", getCardValue(data.total_conversion_time));

    element.appendChild(cardElement);

    return cardElement;
}

function appendToConvertFileCard(element, data) {
    var cardElement = document.createElement("article");
    cardElement.classList.add("converted-file-card");

    var headerElement = document.createElement("div");
    headerElement.classList.add("converted-file-header");
    cardElement.appendChild(headerElement);

    var titleElement = document.createElement("h4");
    titleElement.classList.add("converted-file-name");
    titleElement.innerText = data.filename;
    headerElement.appendChild(titleElement);

    var detailsElement = document.createElement("div");
    detailsElement.classList.add("converted-file-details");
    cardElement.appendChild(detailsElement);

    codecValue = formatCodecValue(data.video_codec) + " / " + formatCodecValue(data.audio_codec);

    appendCardStat(detailsElement, "Current Size", getCardValue(data.current_size, "--", false, false, true));
    appendCardStat(detailsElement, "Video / Audio Codec", getCardValue(codecValue));
    appendCardStat(detailsElement, "Duration", getCardValue(data.video_duration));

    element.appendChild(cardElement);

    return cardElement;
}

function appendCardStat(element, label, value) {
    var statElement = document.createElement("div");
    statElement.classList.add("converted-file-stat");

    var labelElement = document.createElement("span");
    labelElement.classList.add("converted-file-stat-label");
    labelElement.innerText = label;
    statElement.appendChild(labelElement);

    var valueElement = document.createElement("span");
    valueElement.classList.add("converted-file-stat-value");
    valueElement.innerText = value;
    statElement.appendChild(valueElement);

    element.appendChild(statElement);
}

function getCardValue(value, fallback = "--", percentage = false, isDateTime = false, isSize = false) {
    if (value == null || value === "") {
        return fallback;
    }

    if (isSize) {
        return formatSizeForDisplay(value);
    }

    if (isDateTime) {
        return formatDateTime(value);
    }

    if (percentage) {
        return value.toFixed(2) + "%";
    }

    return value;
}

function formatSizeForDisplay(value, sourceUnit = "") {
    sizeGb = parseSizeToGigabytes(value, sourceUnit);

    if (sizeGb == null) {
        return String(value);
    }

    if (sizeGb >= 1024) {
        return (sizeGb / 1024).toFixed(2) + " TB";
    }

    if (sizeGb >= 1) {
        return sizeGb.toFixed(2) + " GB";
    }

    return (sizeGb * 1024).toFixed(2) + " MB";
}

function parseSizeToGigabytes(value, sourceUnit = "") {
    if (typeof value === "number") {
        if (sourceUnit === "TB") {
            return value * 1024;
        }

        if (sourceUnit === "MB") {
            return value / 1024;
        }

        // Default numeric values from backend stats are gigabytes.
        return value;
    }

    if (typeof value !== "string") {
        return null;
    }

    match = value.trim().match(/^([0-9]*\.?[0-9]+)\s*(MB|GB|TB)$/i);
    if (match == null) {
        return null;
    }

    numericValue = parseFloat(match[1]);
    unit = match[2].toUpperCase();

    if (unit === "TB") {
        return numericValue * 1024;
    }

    if (unit === "MB") {
        return numericValue / 1024;
    }

    return numericValue;
}

function formatCodecValue(value) {
    if (value == null || value === "") {
        return "Unknown";
    }

    return String(value).toUpperCase();
}

function formatDateTime(dateTimeString) {
    var parsedDate = new Date(dateTimeString);
    if (Number.isNaN(parsedDate.getTime())) {
        return dateTimeString;
    }

    return parsedDate.toLocaleString("en-GB", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).replace(",", "");
}

function enableFilenamePopup(wrapperElement, filename) {
    if (wrapperElement == null) {
        return;
    }

    var filenameElement = wrapperElement.querySelector(".filename");
    if (filenameElement == null) {
        return;
    }

    var filenameTextElement = filenameElement.querySelector(".filename-text");
    if (filenameTextElement == null) {
        filenameTextElement = document.createElement("span");
        filenameTextElement.classList.add("filename-text");
        filenameTextElement.innerText = filenameElement.innerText;
        filenameElement.innerText = "";
        filenameElement.appendChild(filenameTextElement);
    }

    filenameElement.dataset.fullFilename = filename;
    filenameElement.title = filename;
    filenameTextElement.innerText = filename;
    filenameElement.setAttribute("tabindex", "0");

    if (filenameElement.dataset.popupBound === "true") {
        return;
    }

    filenameElement.dataset.popupBound = "true";

    filenameElement.addEventListener("click", function(event) {
        event.stopPropagation();
        filenameElement.classList.toggle("filename-expanded");
    });

    filenameElement.addEventListener("keydown", function(event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            filenameElement.classList.toggle("filename-expanded");
        }
    });

    filenameElement.addEventListener("blur", function() {
        filenameElement.classList.remove("filename-expanded");
    });

    if (document.body.dataset.filenamePopupOutsideBound !== "true") {
        document.body.dataset.filenamePopupOutsideBound = "true";
        document.addEventListener("click", function() {
            openElements = document.querySelectorAll(".filename.filename-expanded");
            openElements.forEach(function(element) {
                element.classList.remove("filename-expanded");
            });
        });
    }
}

function updateFilenamePopupText(filenameElement, filename) {
    if (filenameElement == null) {
        return;
    }

    var filenameTextElement = filenameElement.querySelector(".filename-text");
    if (filenameTextElement == null) {
        filenameTextElement = document.createElement("span");
        filenameTextElement.classList.add("filename-text");
        filenameElement.innerText = "";
        filenameElement.appendChild(filenameTextElement);
    }

    filenameTextElement.innerText = filename;
    filenameElement.dataset.fullFilename = filename;
    filenameElement.title = filename;
}
