(function () {
    "use strict";

    const root = document.getElementById("media-manager-root");
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const listEndpoint = root.dataset.listEndpoint || "/media/api/files/";
    const detailEndpoint = root.dataset.detailEndpoint || "/media/api/files/detail/";
    const queueEndpoint = root.dataset.queueEndpoint || "/media/api/files/queue/";
    const restartEndpoint = root.dataset.restartEndpoint || "/media/api/files/restart-error/";
    const csrfToken = root.dataset.csrfToken || "";

    const filterForm = document.getElementById("media-filter-form");
    const conversionRequiredSelect = document.getElementById("media-filter-conversion-required");
    const conversionErrorSelect = document.getElementById("media-filter-conversion-error");
    const refreshButton = document.getElementById("media-refresh-button");
    const statusBanner = document.getElementById("media-status-banner");
    const subtitle = document.getElementById("media-results-subtitle");
    const cardGrid = document.getElementById("media-card-grid");
    const emptyState = document.getElementById("media-empty-state");
    const loadingOverlay = document.getElementById("media-loading-overlay");
    const loadingText = document.getElementById("media-loading-text");
    const detailOverlay = document.getElementById("media-detail-overlay");
    const detailTitle = document.getElementById("media-detail-title");
    const detailBody = document.getElementById("media-detail-body");
    const detailCloseButton = document.getElementById("media-detail-close-button");
    const summaryTotal = document.getElementById("media-summary-total");
    const summaryDisplayed = document.getElementById("media-summary-displayed");
    const summaryErrors = document.getElementById("media-summary-errors");
    const summaryQueueable = document.getElementById("media-summary-queueable");

    const state = {
        files: [],
        totalCount: 0,
        openFilename: "",
        requestVersion: 0,
    };

    function normalizeFilterValue(value) {
        return value === "true" || value === "false" ? value : "any";
    }

    function setLoading(isLoading, message) {
        if (!(loadingOverlay instanceof HTMLElement) || !(loadingText instanceof HTMLElement)) {
            return;
        }

        loadingOverlay.hidden = !isLoading;
        loadingText.textContent = isLoading ? message : "";
    }

    function setStatus(message, tone) {
        if (!(statusBanner instanceof HTMLElement)) {
            return;
        }

        const normalizedMessage = typeof message === "string" ? message.trim() : "";
        if (normalizedMessage === "") {
            statusBanner.hidden = true;
            statusBanner.className = "media-status-banner";
            statusBanner.textContent = "";
            return;
        }

        statusBanner.hidden = false;
        statusBanner.className = `media-status-banner is-${tone}`;
        statusBanner.textContent = normalizedMessage;
    }

    function setSummaryValue(node, value) {
        if (node instanceof HTMLElement) {
            node.textContent = String(value);
        }
    }

    function formatDateTime(value) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (normalized === "") {
            return "-";
        }

        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(parsed);
    }

    function formatBoolean(value) {
        return value ? "True" : "False";
    }

    function formatBytes(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return "Unknown";
        }

        const units = ["B", "KB", "MB", "GB", "TB", "PB"];
        let size = numericValue;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size = size / 1024;
            unitIndex += 1;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    async function requestJson(url, options) {
        const response = await fetch(url, options);
        const responseText = await response.text();
        let payload = {};

        if (responseText.trim() !== "") {
            try {
                payload = JSON.parse(responseText);
            } catch (_error) {
                payload = {};
            }
        }

        if (!response.ok) {
            const detail = payload.detail || payload.message || `Request failed with status ${response.status}.`;
            throw new Error(detail);
        }

        return payload;
    }

    function createPill(label, tone) {
        const pill = document.createElement("span");
        pill.className = `media-pill ${tone}`;
        pill.textContent = label;
        return pill;
    }

    function createFact(label, value) {
        const wrapper = document.createElement("div");
        wrapper.className = "media-fact";

        const labelNode = document.createElement("span");
        labelNode.className = "media-fact-label";
        labelNode.textContent = label;

        const valueNode = document.createElement("strong");
        valueNode.className = "media-fact-value";
        valueNode.textContent = value;

        wrapper.append(labelNode, valueNode);
        return wrapper;
    }

    function detailField(label, value) {
        const wrapper = document.createElement("div");
        wrapper.className = "media-detail-field";

        const term = document.createElement("span");
        term.className = "media-detail-term";
        term.textContent = label;

        const description = document.createElement("strong");
        description.className = "media-detail-description";
        description.textContent = value;

        wrapper.append(term, description);
        return wrapper;
    }

    function updateSummary() {
        const files = Array.isArray(state.files) ? state.files : [];
        const errorCount = files.filter(file => Boolean(file.conversion_error)).length;
        const queueableCount = files.filter(file => Boolean(file.can_queue)).length;

        setSummaryValue(summaryTotal, state.totalCount);
        setSummaryValue(summaryDisplayed, files.length);
        setSummaryValue(summaryErrors, errorCount);
        setSummaryValue(summaryQueueable, queueableCount);

        if (subtitle instanceof HTMLElement) {
            if (state.totalCount > files.length) {
                subtitle.textContent = `Showing the first ${files.length} of ${state.totalCount} matching media records.`;
            } else if (files.length === 0) {
                subtitle.textContent = "No records matched the selected filters.";
            } else {
                subtitle.textContent = `${files.length} media records matched the current filters.`;
            }
        }
    }

    function renderFiles() {
        if (!(cardGrid instanceof HTMLElement) || !(emptyState instanceof HTMLElement)) {
            return;
        }

        cardGrid.replaceChildren();

        if (!Array.isArray(state.files) || state.files.length === 0) {
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;

        state.files.forEach(file => {
            const card = document.createElement("article");
            card.className = "media-card site-card";

            const header = document.createElement("div");
            header.className = "media-card-header";

            const titleWrap = document.createElement("div");
            titleWrap.className = "media-card-title-wrap";

            const title = document.createElement("h5");
            title.className = "media-card-title";
            title.textContent = file.display_name || file.filename || "Unknown";

            const path = document.createElement("p");
            path.className = "media-card-path";
            path.textContent = file.parent_directory || file.filename || "";

            titleWrap.append(title, path);

            const statusList = document.createElement("div");
            statusList.className = "media-status-list";
            statusList.appendChild(createPill(file.status_label || "Unknown", file.conversion_error ? "is-danger" : file.converted ? "is-success" : file.conversion_required ? "is-primary" : "is-warning"));

            if (file.conversion_required) {
                statusList.appendChild(createPill("Needs conversion", "is-primary"));
            }

            if (file.conversion_error) {
                statusList.appendChild(createPill("Error", "is-danger"));
            }

            if (file.converting) {
                statusList.appendChild(createPill("Active", "is-primary"));
            }

            header.append(titleWrap, statusList);

            const facts = document.createElement("div");
            facts.className = "media-card-facts";
            facts.append(
                createFact("Current size", file.current_size || "Unknown"),
                createFact("Original size", file.pre_conversion_size || "Unknown"),
                createFact("Duration", file.video_duration || "Unknown"),
                createFact("Codecs", `${file.video_codec || "Unknown"} / ${file.audio_codec || "Unknown"}`),
                createFact("Bit rate", file.bit_rate || "Unknown"),
                createFact("Streams", `${Number(file.video_streams || 0)}/${Number(file.audio_streams || 0)}/${Number(file.subtitle_streams || 0)}`)
            );

            const actions = document.createElement("div");
            actions.className = "media-card-actions";

            const detailsButton = document.createElement("button");
            detailsButton.type = "button";
            detailsButton.className = "media-button media-button-secondary";
            detailsButton.textContent = "View details";
            detailsButton.addEventListener("click", () => {
                void openDetails(file.filename || "");
            });
            actions.appendChild(detailsButton);

            const queueButton = document.createElement("button");
            queueButton.type = "button";
            queueButton.className = "media-button media-button-primary";
            queueButton.textContent = "Queue file";
            queueButton.disabled = !file.can_queue;
            queueButton.addEventListener("click", () => {
                void runAction(queueEndpoint, file.filename || "", "File queued for conversion.");
            });
            actions.appendChild(queueButton);

            const restartButton = document.createElement("button");
            restartButton.type = "button";
            restartButton.className = "media-button media-button-danger";
            restartButton.textContent = "Clear error";
            restartButton.disabled = !file.can_restart_error;
            restartButton.addEventListener("click", () => {
                void runAction(restartEndpoint, file.filename || "", "Conversion error cleared.");
            });
            actions.appendChild(restartButton);

            card.append(header, facts, actions);
            cardGrid.appendChild(card);
        });
    }

    function closeDetails() {
        if (detailOverlay instanceof HTMLElement) {
            detailOverlay.hidden = true;
        }
        document.body.classList.remove("media-modal-open");
        state.openFilename = "";
    }

    function renderDetailContent(file) {
        if (!(detailBody instanceof HTMLElement) || !(detailTitle instanceof HTMLElement)) {
            return;
        }

        detailTitle.textContent = file.filename || "Media details";
        detailBody.replaceChildren();

        const actions = document.createElement("div");
        actions.className = "media-detail-actions";

        const queueButton = document.createElement("button");
        queueButton.type = "button";
        queueButton.className = "media-button media-button-primary";
        queueButton.textContent = "Queue file";
        queueButton.disabled = !(!file.deleted && !file.converted && !file.conversion_required);
        queueButton.addEventListener("click", () => {
            void runAction(queueEndpoint, file.filename || "", "File queued for conversion.");
        });
        actions.appendChild(queueButton);

        const restartButton = document.createElement("button");
        restartButton.type = "button";
        restartButton.className = "media-button media-button-danger";
        restartButton.textContent = "Clear error";
        restartButton.disabled = !Boolean(file.conversion_error);
        restartButton.addEventListener("click", () => {
            void runAction(restartEndpoint, file.filename || "", "Conversion error cleared.");
        });
        actions.appendChild(restartButton);

        const summary = document.createElement("div");
        summary.className = "media-detail-summary";
        summary.append(
            detailField("Filename", file.filename || "Unknown"),
            detailField("Current size", formatBytes(file.current_size)),
            detailField("Original size", formatBytes(file.pre_conversion_size)),
            detailField("Conversion required", formatBoolean(Boolean(file.conversion_required))),
            detailField("Conversion error", formatBoolean(Boolean(file.conversion_error))),
            detailField("Converted", formatBoolean(Boolean(file.converted))),
            detailField("Converting", formatBoolean(Boolean(file.converting))),
            detailField("Copying", formatBoolean(Boolean(file.copying))),
            detailField("Video streams", String(Number(file.video_streams || 0))),
            detailField("Audio streams", String(Number(file.audio_streams || 0))),
            detailField("Subtitle streams", String(Number(file.subtitle_streams || 0))),
            detailField("Start time", formatDateTime(file.start_conversion_time)),
            detailField("End time", formatDateTime(file.end_conversion_time)),
            detailField("Backend", String(file.backend_name || "None"))
        );

        const jsonSection = document.createElement("section");
        jsonSection.className = "media-detail-json";

        const jsonHeader = document.createElement("div");
        jsonHeader.className = "media-detail-json-header";

        const jsonTitle = document.createElement("h5");
        jsonTitle.className = "media-card-title";
        jsonTitle.textContent = "Raw document";

        const jsonCopy = document.createElement("p");
        jsonCopy.className = "media-detail-json-copy";
        jsonCopy.textContent = "All stored fields are included below.";

        jsonHeader.append(jsonTitle, jsonCopy);

        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(file, null, 2);

        jsonSection.append(jsonHeader, pre);
        detailBody.append(actions, summary, jsonSection);
    }

    async function openDetails(filename) {
        if (!(detailOverlay instanceof HTMLElement) || !(detailBody instanceof HTMLElement) || !(detailTitle instanceof HTMLElement)) {
            return;
        }

        if (typeof filename !== "string" || filename.trim() === "") {
            return;
        }

        state.openFilename = filename;
        detailOverlay.hidden = false;
        document.body.classList.add("media-modal-open");
        detailTitle.textContent = filename;
        detailBody.textContent = "Loading media details...";

        try {
            const url = new URL(detailEndpoint, window.location.origin);
            url.searchParams.set("filename", filename);
            const payload = await requestJson(url.toString(), { method: "GET" });
            renderDetailContent(payload.file || {});
        } catch (error) {
            detailBody.textContent = error instanceof Error ? error.message : "Failed to load media details.";
        }
    }

    async function runAction(endpoint, filename, successMessage) {
        if (typeof filename !== "string" || filename.trim() === "") {
            return;
        }

        setLoading(true, successMessage);

        try {
            const payload = await requestJson(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken,
                },
                body: JSON.stringify({ filename }),
            });

            setStatus(payload.message || successMessage, "success");
            await loadFiles();

            if (state.openFilename === filename) {
                await openDetails(filename);
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Action failed.", "error");
        } finally {
            setLoading(false, "");
        }
    }

    async function loadFiles() {
        const requestVersion = state.requestVersion + 1;
        state.requestVersion = requestVersion;

        setLoading(true, "Loading media files...");

        try {
            const url = new URL(listEndpoint, window.location.origin);
            const conversionRequired = normalizeFilterValue(conversionRequiredSelect instanceof HTMLSelectElement ? conversionRequiredSelect.value : "any");
            const conversionError = normalizeFilterValue(conversionErrorSelect instanceof HTMLSelectElement ? conversionErrorSelect.value : "any");

            if (conversionRequired !== "any") {
                url.searchParams.set("conversion_required", conversionRequired);
            }

            if (conversionError !== "any") {
                url.searchParams.set("conversion_error", conversionError);
            }

            const payload = await requestJson(url.toString(), { method: "GET" });
            if (requestVersion !== state.requestVersion) {
                return;
            }

            state.files = Array.isArray(payload.files) ? payload.files : [];
            state.totalCount = Number(payload.total_count || state.files.length);

            updateSummary();
            renderFiles();
            setStatus("", "info");
        } catch (error) {
            state.files = [];
            state.totalCount = 0;
            updateSummary();
            renderFiles();
            setStatus(error instanceof Error ? error.message : "Failed to load media files.", "error");
        } finally {
            setLoading(false, "");
        }
    }

    if (filterForm instanceof HTMLFormElement) {
        filterForm.addEventListener("submit", event => {
            event.preventDefault();
            void loadFiles();
        });
    }

    if (refreshButton instanceof HTMLButtonElement) {
        refreshButton.addEventListener("click", () => {
            void loadFiles();
        });
    }

    if (detailCloseButton instanceof HTMLButtonElement) {
        detailCloseButton.addEventListener("click", closeDetails);
    }

    if (detailOverlay instanceof HTMLElement) {
        detailOverlay.addEventListener("click", event => {
            if (event.target === detailOverlay) {
                closeDetails();
            }
        });
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && detailOverlay instanceof HTMLElement && !detailOverlay.hidden) {
            closeDetails();
        }
    });

    void loadFiles();
})();