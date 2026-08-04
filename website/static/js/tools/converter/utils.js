function appendKeyValueElement(element, key, value, additionalKeyClass = [], additionalValueClass = [], id = "", wrapperClass = []) {
    var wrapperElement = document.createElement("div");
    wrapperElement.classList.add("key-value-wrapper");
    if (wrapperClass.length > 0) {
        wrapperElement.classList.add(...wrapperClass);
    }

    var keyElement = document.createElement("div");
    keyElement.classList.add("data-key");

    if (additionalKeyClass.length > 0) {
        keyElement.classList.add(...additionalKeyClass);
    }

    var valueElement = document.createElement("div");
    valueElement.classList.add("data-value");

    if (id.length > 0) {
        keyElement.id = id + "-key";
        valueElement.id = id + "-value";
    }

    if (additionalValueClass.length > 0) {
        valueElement.classList.add(...additionalValueClass);
    }

    keyElement.innerText = key;
    valueElement.innerText = value;

    wrapperElement.appendChild(keyElement);
    wrapperElement.appendChild(valueElement);
    element.appendChild(wrapperElement);

    return wrapperElement;
}

function appendConvertedFileCard(element, data) {
    var ratioNumber = null;
    if (data.percentage_saved != null && data.percentage_saved !== "") {
        ratioNumber = Math.round(Number(data.percentage_saved));
    }

    var originalSize = getCardValue(data.pre_conversion_size, "--", false, false, true);
    var newSize = getCardValue(data.current_size, "--", false, false, true);

    var row = createFileRow({
        kind: "converted",
        status: "Converted",
        filename: data.filename,
        displayTitle: data.display_title || data.filename,
        coverArtUrl: data.cover_art_url,
        coverArtStatus: data.cover_art_status || "pending",
        coverArtKey: data.cover_art_key || "",
        heroValue: ratioNumber == null || Number.isNaN(ratioNumber) ? "--" : ratioNumber + "%",
        heroLabel: "saved",
        fromSize: originalSize,
        toSize: newSize,
        fillPercent: ratioNumber == null || Number.isNaN(ratioNumber) ? 0 : Math.max(8, Math.min(100, ratioNumber)),
        facts: [
            { label: "Original", value: originalSize },
            { label: "New", value: newSize },
            { label: "Took", value: getCardValue(data.total_conversion_time) },
            { label: "Ended", value: getCardValue(data.end_conversion_time, "--", false, true) }
        ]
    });

    attachConvertedFileInfoButton(row, data);
    element.appendChild(row);
    return row;
}

function appendToConvertFileCard(element, data) {
    var predictedRatioNumber = null;
    if (data.estimated_percentage_saved != null && data.estimated_percentage_saved !== "") {
        predictedRatioNumber = Math.round(Number(data.estimated_percentage_saved));
    }

    var currentSize = getCardValue(data.current_size, "--", false, false, true);
    var predictedSize = getCardValue(data.estimated_size_after_conversion, "--", false, false, true);
    var codecValue = formatCodecValue(data.video_codec) + " / " + formatCodecValue(data.audio_codec);
    var confidenceText = getCardValue(data.prediction_confidence, "Low");
    var queueStatus = String(data.queue_status || "queued").toLowerCase();
    var statusLabel = "Queued";
    var rowKind = "pending";
    if (queueStatus === "converting") {
        statusLabel = "Converting";
        rowKind = "converting";
    } else if (queueStatus === "copying") {
        statusLabel = "Copying";
        rowKind = "converting";
    }

    var row = createFileRow({
        kind: rowKind,
        status: statusLabel,
        filename: data.filename,
        displayTitle: data.display_title || data.filename,
        coverArtUrl: data.cover_art_url,
        coverArtStatus: data.cover_art_status || "pending",
        coverArtKey: data.cover_art_key || "",
        confidence: confidenceText,
        heroValue: predictedRatioNumber == null || Number.isNaN(predictedRatioNumber)
            ? "--"
            : predictedRatioNumber + "%",
        heroLabel: "est. save",
        fromSize: currentSize,
        toSize: predictedSize,
        fillPercent: predictedRatioNumber == null || Number.isNaN(predictedRatioNumber)
            ? 0
            : Math.max(8, Math.min(100, predictedRatioNumber)),
        facts: [
            { label: "Current", value: currentSize },
            { label: "Predicted", value: predictedSize },
            { label: "Duration", value: getCardValue(data.video_duration) },
            { label: "Codecs", value: getCardValue(codecValue) }
        ]
    });

    element.appendChild(row);
    return row;
}

function createFileRow(options) {
    var row = document.createElement("article");
    row.classList.add("file-row", "file-row--" + options.kind, "converted-file-card");

    var art = document.createElement("div");
    art.classList.add("file-row-art");
    row.appendChild(art);

    var poster = document.createElement("img");
    poster.classList.add("file-row-poster");
    poster.alt = "";
    poster.loading = "lazy";
    poster.decoding = "async";
    poster.dataset.artStatus = options.coverArtStatus || "pending";
    poster.dataset.artKey = options.coverArtKey || "";
    poster.src = options.coverArtUrl || "/icons/tools/converter/art-placeholder.svg";
    poster.addEventListener("error", function() {
        console.warn("[converter-art] poster error", {
            key: poster.dataset.artKey,
            status: poster.dataset.artStatus,
            src: poster.getAttribute("src")
        });
        poster.dataset.artStatus = "img_error";
        poster.src = "/icons/tools/converter/art-placeholder.svg";
    });
    art.appendChild(poster);

    var main = document.createElement("div");
    main.classList.add("file-row-main");
    row.appendChild(main);

    var meta = document.createElement("div");
    meta.classList.add("file-row-meta");
    main.appendChild(meta);

    var status = document.createElement("span");
    status.classList.add("file-status");
    status.innerText = options.status;
    meta.appendChild(status);

    if (options.confidence) {
        var confidence = document.createElement("span");
        confidence.classList.add(
            "prediction-confidence-badge",
            "prediction-confidence-" + String(options.confidence).trim().toLowerCase()
        );
        confidence.innerText = options.confidence;
        meta.appendChild(confidence);
    }

    var name = document.createElement("h4");
    name.classList.add("file-row-name", "converted-file-name");
    name.innerText = options.displayTitle || options.filename;
    if (options.filename && options.displayTitle && options.filename !== options.displayTitle) {
        name.title = options.filename;
    }
    main.appendChild(name);

    var facts = document.createElement("div");
    facts.classList.add("file-row-facts");
    main.appendChild(facts);

    for (var i = 0; i < options.facts.length; i++) {
        appendFileFact(facts, options.facts[i].label, options.facts[i].value);
    }

    var hero = document.createElement("div");
    hero.classList.add("file-row-hero");
    row.appendChild(hero);

    var heroValue = document.createElement("span");
    heroValue.classList.add("file-row-hero-value");
    heroValue.innerText = options.heroValue;
    hero.appendChild(heroValue);

    var heroLabel = document.createElement("span");
    heroLabel.classList.add("file-row-hero-label");
    heroLabel.innerText = options.heroLabel;
    hero.appendChild(heroLabel);

    var sizeBar = document.createElement("div");
    sizeBar.classList.add("file-row-sizebar");
    row.appendChild(sizeBar);

    var fromLabel = document.createElement("span");
    fromLabel.classList.add("file-row-sizebar-label");
    fromLabel.innerText = options.fromSize;
    sizeBar.appendChild(fromLabel);

    var track = document.createElement("div");
    track.classList.add("file-row-sizebar-track");
    sizeBar.appendChild(track);

    var fill = document.createElement("div");
    fill.classList.add("file-row-sizebar-fill");
    fill.style.width = options.fillPercent + "%";
    track.appendChild(fill);

    var toLabel = document.createElement("span");
    toLabel.classList.add("file-row-sizebar-label");
    toLabel.innerText = options.toSize;
    sizeBar.appendChild(toLabel);

    return row;
}

function appendFileFact(element, label, value) {
    var fact = document.createElement("span");
    fact.classList.add("file-fact");

    var labelElement = document.createElement("span");
    labelElement.classList.add("file-fact-label");
    labelElement.innerText = label;
    fact.appendChild(labelElement);

    var valueElement = document.createElement("span");
    valueElement.classList.add("file-fact-value");
    valueElement.innerText = value;
    fact.appendChild(valueElement);

    element.appendChild(fact);
}

function attachConvertedFileInfoButton(row, data) {
    row.dataset.fileInfo = JSON.stringify(data);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "file-info-button";
    button.setAttribute("aria-label", "File details for " + (data.display_title || data.filename || "converted file"));
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "file-info-dialog");
    button.title = "File details";
    button.innerHTML = [
        '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">',
        '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"></circle>',
        '<circle cx="12" cy="8" r="1.15" fill="currentColor" stroke="none"></circle>',
        '<path d="M12 11.2v6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
        "</svg>"
    ].join("");

    button.addEventListener("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        var payload = data;
        try {
            if (row.dataset.fileInfo) {
                payload = JSON.parse(row.dataset.fileInfo);
            }
        } catch (error) {
            payload = data;
        }
        openFileInfoDialog(payload);
    });

    row.appendChild(button);
}

function formatMediaKindLabel(mediaKind) {
    var kind = String(mediaKind || "").trim().toLowerCase();
    if (kind === "film" || kind === "movie") {
        return "Film";
    }
    if (kind === "tv" || kind === "series" || kind === "episode") {
        return "TV";
    }
    if (kind === "") {
        return "Media";
    }
    return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatDetailDateTime(dateTimeString) {
    if (dateTimeString == null || dateTimeString === "" || dateTimeString === "Unknown") {
        return "--";
    }

    var parsedDate = new Date(dateTimeString);
    if (Number.isNaN(parsedDate.getTime())) {
        return String(dateTimeString);
    }

    return parsedDate.toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).replace(",", "");
}

function appendFileInfoStat(container, label, value) {
    var item = document.createElement("div");
    item.className = "file-info-stat";

    var labelElement = document.createElement("span");
    labelElement.className = "file-info-stat-label";
    labelElement.innerText = label;
    item.appendChild(labelElement);

    var valueElement = document.createElement("span");
    valueElement.className = "file-info-stat-value";
    valueElement.innerText = value;
    item.appendChild(valueElement);

    container.appendChild(item);
}

function openFileInfoDialog(data) {
    var dialog = document.getElementById("file-info-dialog");
    var poster = document.getElementById("file-info-dialog-poster");
    var kindElement = document.getElementById("file-info-kind");
    var titleElement = document.getElementById("file-info-title");
    var filenameElement = document.getElementById("file-info-filename");
    var statsElement = document.getElementById("file-info-stats");

    if (dialog == null || statsElement == null) {
        return;
    }

    var title = data.display_title || data.filename || "Converted file";
    var posterUrl = data.cover_art_url || "/icons/tools/converter/art-placeholder.svg";
    var ratioNumber = data.percentage_saved == null || data.percentage_saved === ""
        ? null
        : Math.round(Number(data.percentage_saved));
    var savedLabel = ratioNumber == null || Number.isNaN(ratioNumber) ? "--" : ratioNumber + "%";

    if (poster != null) {
        poster.src = posterUrl;
        poster.alt = "";
        poster.onerror = function() {
            poster.onerror = null;
            poster.src = "/icons/tools/converter/art-placeholder.svg";
        };
    }

    if (kindElement != null) {
        kindElement.innerText = formatMediaKindLabel(data.media_kind);
    }

    if (titleElement != null) {
        titleElement.innerText = title;
    }

    if (filenameElement != null) {
        filenameElement.innerText = data.filename || "";
        filenameElement.hidden = !data.filename || data.filename === title;
        filenameElement.title = data.filename || "";
    }

    while (statsElement.firstChild) {
        statsElement.removeChild(statsElement.firstChild);
    }

    appendFileInfoStat(statsElement, "Saved", savedLabel);
    appendFileInfoStat(
        statsElement,
        "Original size",
        getCardValue(data.pre_conversion_size, "--", false, false, true)
    );
    appendFileInfoStat(
        statsElement,
        "New size",
        getCardValue(data.current_size, "--", false, false, true)
    );
    appendFileInfoStat(
        statsElement,
        "Bytes saved",
        getCardValue(data.bytes_saved, "--", false, false, true)
    );
    appendFileInfoStat(statsElement, "Took", getCardValue(data.total_conversion_time));
    appendFileInfoStat(statsElement, "Started", formatDetailDateTime(data.start_conversion_time));
    appendFileInfoStat(statsElement, "Ended", formatDetailDateTime(data.end_conversion_time));
    appendFileInfoStat(statsElement, "Duration", getCardValue(data.video_duration));
    appendFileInfoStat(statsElement, "Resolution", getCardValue(data.resolution));
    appendFileInfoStat(
        statsElement,
        "Codecs",
        formatCodecValue(data.video_codec) + " / " + formatCodecValue(data.audio_codec)
    );
    appendFileInfoStat(statsElement, "Bit rate", getCardValue(data.bit_rate));
    appendFileInfoStat(statsElement, "Backend", getCardValue(data.backend_name, "—"));

    if (typeof dialog.showModal === "function") {
        dialog.showModal();
    } else {
        dialog.setAttribute("open", "");
    }
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
        weekday: "short",
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
    filenameElement.removeAttribute("title");
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
    filenameElement.removeAttribute("title");
}
