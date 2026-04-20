let footballTableSocket = null;
let footballTableUrl;
let footballTableIntervalId = null;
let selectedTeamId = null;
let hoveredTeamId = null;
let footballTableLoadedDayKey = null;
let lastInteractionPointerType = "mouse";

const FOOTBALL_TABLE_REFRESH_INTERVAL_MS = 10000;
const RANGE_CLASSES = [
    "table-range-focus",
    "table-range-high",
    "table-range-high-boundary",
    "table-range-low",
    "table-range-low-boundary"
];
const SEASON_ZONE_CLASSES = [
    "table-zone-ucl",
    "table-zone-uel",
    "table-zone-uecl",
    "table-zone-relegation"
];

const footballTableHtmlElement = document.documentElement;
const footballTableBasePathRaw = String(footballTableHtmlElement.dataset.footballBasePath ?? "/football").trim();
const footballTableBasePath = footballTableBasePathRaw === "/" ? "" : footballTableBasePathRaw.replace(/\/+$/, "");
const footballTableRootPath = footballTableBasePath === "" ? "/" : `${footballTableBasePath}/`;

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function buildSeasonQuery(seasonKey) {
    if (!seasonKey) {
        return "";
    }

    return `?season=${encodeURIComponent(seasonKey)}`;
}

function updateTextIfChanged(element, value) {
    if (!element) {
        return;
    }

    const safeValue = value === null || value === undefined ? "" : String(value);
    if (element.textContent !== safeValue) {
        element.textContent = safeValue;
    }
}

function isTableItemInPlay(tableItem) {
    const cssClass = typeof tableItem?.css_class === "string" ? tableItem.css_class : "";
    return cssClass.includes("in-play");
}

function updateLiveIndicator(row, tableItem) {
    const indicatorCell = row.querySelector(".live-indicator-cell");
    if (!indicatorCell) {
        return;
    }

    const shouldShowIndicator = isTableItemInPlay(tableItem);
    let indicatorDot = indicatorCell.querySelector(".live-indicator-dot");

    if (shouldShowIndicator) {
        if (!indicatorDot) {
            indicatorDot = document.createElement("span");
            indicatorDot.className = "live-indicator-dot";
            indicatorDot.setAttribute("aria-hidden", "true");
            indicatorCell.appendChild(indicatorDot);
        }
        return;
    }

    if (indicatorDot) {
        indicatorDot.remove();
    }
}

function updatePositionDelta(row, tableItem) {
    const deltaCell = row.querySelector(".position-delta-cell");
    if (!deltaCell) {
        return;
    }

    let deltaElement = deltaCell.querySelector(".table-position-delta");

    if (tableItem.has_started) {
        if (!deltaElement) {
            deltaElement = document.createElement("div");
            deltaElement.classList.add("table-position-delta");
            deltaCell.appendChild(deltaElement);
        }

        deltaElement.className = `table-position-delta ${tableItem.css_class || ""}`.trim();
        const compactScore = String(tableItem.score_string || "").replaceAll(" ", "");
        updateTextIfChanged(deltaElement, compactScore);
        return;
    }

    if (deltaElement) {
        deltaElement.remove();
    }
}

function updateFormContainer(row, formList, formText) {
    const formContainer = row.querySelector(".form-container");
    if (!formContainer) {
        return;
    }

    formContainer.replaceChildren();

    if (Array.isArray(formList) && formList.length > 0) {
        formList
            .slice()
            .forEach(item => {
                const formElement = document.createElement("div");
                formElement.className = `form-character ${item.css_class || ""}`.trim();
                formElement.textContent = item.character || "-";
                formContainer.appendChild(formElement);
            });
        return;
    }

    const fallbackElement = document.createElement("span");
    if (typeof formText === "string" && formText.trim() !== "") {
        fallbackElement.textContent = formText;
    } else {
        fallbackElement.textContent = "-";
    }
    formContainer.appendChild(fallbackElement);
}

function updateTeamLink(row, teamId, seasonKey) {
    const teamLinkElement = row.querySelector(".team-name");
    if (!teamLinkElement) {
        return;
    }

    const expectedHref = `${footballTableRootPath}matches/team/${teamId}/${buildSeasonQuery(seasonKey)}`;
    if (teamLinkElement.getAttribute("href") !== expectedHref) {
        teamLinkElement.setAttribute("href", expectedHref);
    }
}

function updateSeasonZoneClasses(row, position, teamCount) {
    SEASON_ZONE_CLASSES.forEach(className => row.classList.remove(className));

    if (position <= 5) {
        row.classList.add("table-zone-ucl");
        return;
    }

    if (position === 6) {
        row.classList.add("table-zone-uel");
        return;
    }

    if (position === 7) {
        row.classList.add("table-zone-uecl");
        return;
    }

    const relegationCutoff = Math.max(teamCount - 2, 1);
    if (position >= relegationCutoff) {
        row.classList.add("table-zone-relegation");
    }
}

function updateTableRow(row, tableItem, seasonKey, teamCount) {
    row.dataset.position = String(tableItem.position);
    row.dataset.played = String(tableItem.played_games);
    row.dataset.points = String(tableItem.points);

    updateSeasonZoneClasses(row, Number(tableItem.position), teamCount);

    updateTextIfChanged(row.querySelector(".table-position-value"), tableItem.position);
    updateLiveIndicator(row, tableItem);
    updatePositionDelta(row, tableItem);
    updateTextIfChanged(row.querySelector(".table-played"), tableItem.played_games);
    updateTextIfChanged(row.querySelector(".table-won"), tableItem.won);
    updateTextIfChanged(row.querySelector(".table-draw"), tableItem.draw);
    updateTextIfChanged(row.querySelector(".table-lost"), tableItem.lost);
    updateTextIfChanged(row.querySelector(".table-goals-for"), tableItem.goals_for);
    updateTextIfChanged(row.querySelector(".table-goals-against"), tableItem.goals_against);
    updateTextIfChanged(row.querySelector(".table-goal-difference"), tableItem.goal_difference);
    updateTextIfChanged(row.querySelector(".table-points"), tableItem.points);
    updateFormContainer(row, tableItem.form_list, tableItem.form);
    updateTeamLink(row, tableItem.team.id, seasonKey);
}

function getTableRows() {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        return [];
    }

    return Array.from(tbody.querySelectorAll(".data-row[data-team-id]"));
}

function clearRangeHighlights() {
    getTableRows().forEach(row => {
        RANGE_CLASSES.forEach(className => row.classList.remove(className));
    });
}

function asNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function applyRangeHighlights(activeRow) {
    if (!activeRow) {
        clearRangeHighlights();
        return;
    }

    const rows = getTableRows();
    if (rows.length < 2) {
        clearRangeHighlights();
        return;
    }

    clearRangeHighlights();
    activeRow.classList.add("table-range-focus");

    const teamCount = rows.length;
    const totalGames = Math.max((teamCount - 1) * 2, 0);
    const activePosition = asNumber(activeRow.dataset.position);
    const activePoints = asNumber(activeRow.dataset.points);
    const activePlayed = asNumber(activeRow.dataset.played);
    const activeMaxPoints = activePoints + Math.max(0, totalGames - activePlayed) * 3;
    const activeMinPoints = activePoints;

    const highestPossiblePosition =
        1 + rows.filter(row => row !== activeRow && asNumber(row.dataset.points) > activeMaxPoints).length;

    const lowestPossiblePosition =
        1 + rows.filter(row => {
            if (row === activeRow) {
                return false;
            }

            const otherPoints = asNumber(row.dataset.points);
            const otherPlayed = asNumber(row.dataset.played);
            const otherMaxPoints = otherPoints + Math.max(0, totalGames - otherPlayed) * 3;
            return otherMaxPoints >= activeMinPoints;
        }).length;

    rows.forEach(row => {
        if (row === activeRow) {
            return;
        }

        const rowPosition = asNumber(row.dataset.position);

        if (rowPosition < activePosition && rowPosition >= highestPossiblePosition) {
            row.classList.add("table-range-high");
            if (rowPosition === highestPossiblePosition) {
                row.classList.add("table-range-high-boundary");
            }
        }

        if (rowPosition > activePosition && rowPosition <= lowestPossiblePosition) {
            row.classList.add("table-range-low");
            if (rowPosition === lowestPossiblePosition) {
                row.classList.add("table-range-low-boundary");
            }
        }
    });
}

function syncSelectedHighlight() {
    if (!selectedTeamId) {
        clearRangeHighlights();
        return;
    }

    const rows = getTableRows();
    const selectedRow = rows.find(row => row.dataset.teamId === selectedTeamId);

    if (!selectedRow) {
        // Keep the selected id so highlight can be restored on subsequent websocket payloads.
        return;
    }

    applyRangeHighlights(selectedRow);
}

function syncActiveRangeHighlight() {
    if (selectedTeamId) {
        syncSelectedHighlight();
        return;
    }

    if (!hoveredTeamId) {
        clearRangeHighlights();
        return;
    }

    const rows = getTableRows();
    const hoveredRow = rows.find(row => row.dataset.teamId === hoveredTeamId);
    if (!hoveredRow) {
        clearRangeHighlights();
        return;
    }

    applyRangeHighlights(hoveredRow);
}

function clearSelectionIfTappedOutsideSelectedRow(event) {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        selectedTeamId = null;
        hoveredTeamId = null;
        clearRangeHighlights();
        return;
    }

    if (!selectedTeamId && !hoveredTeamId) {
        return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
        selectedTeamId = null;
        hoveredTeamId = null;
        clearRangeHighlights();
        return;
    }

    const rows = getTableRows();
    const selectedRow = selectedTeamId
        ? rows.find(row => row.dataset.teamId === selectedTeamId)
        : null;
    if (selectedRow && selectedRow.contains(target)) {
        return;
    }

    const hoveredRow = !selectedRow && hoveredTeamId
        ? rows.find(row => row.dataset.teamId === hoveredTeamId)
        : null;
    if (hoveredRow && hoveredRow.contains(target)) {
        return;
    }

    selectedTeamId = null;
    hoveredTeamId = null;
    clearRangeHighlights();
}

function setupRangeInteractions() {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        return;
    }

    document.addEventListener("pointerdown", event => {
        if (typeof event.pointerType === "string" && event.pointerType !== "") {
            lastInteractionPointerType = event.pointerType;
        }
    }, { passive: true });

    document.addEventListener("touchstart", () => {
        lastInteractionPointerType = "touch";
    }, { passive: true });

    document.addEventListener("mousedown", () => {
        lastInteractionPointerType = "mouse";
    }, { passive: true });

    tbody.addEventListener("mouseover", event => {
        if (selectedTeamId) {
            return;
        }

        const row = event.target.closest(".data-row[data-team-id]");
        if (!row || !tbody.contains(row)) {
            return;
        }

        hoveredTeamId = row.dataset.teamId || null;
        applyRangeHighlights(row);
    });

    tbody.addEventListener("mouseleave", () => {
        hoveredTeamId = null;
        if (selectedTeamId) {
            syncSelectedHighlight();
            return;
        }

        clearRangeHighlights();
    });

    tbody.addEventListener("click", event => {
        if (event.target.closest("a")) {
            return;
        }

        if (lastInteractionPointerType === "mouse") {
            return;
        }

        const row = event.target.closest(".data-row[data-team-id]");
        if (!row || !tbody.contains(row)) {
            return;
        }

        const teamId = row.dataset.teamId;
        if (!teamId) {
            return;
        }

        selectedTeamId = teamId;
        hoveredTeamId = null;
        applyRangeHighlights(row);
    });

    document.addEventListener("click", clearSelectionIfTappedOutsideSelectedRow);
}

function patchLiveTable(tableList) {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody || !Array.isArray(tableList)) {
        return;
    }

    const tableContainer = tbody.closest(".table-container");
    if (tableContainer) {
        tableContainer.dataset.teamCount = String(tableList.length);
        tableContainer.style.setProperty("--table-row-count", String(tableList.length));

        const hasLiveValue = tableList.some(tableItem => isTableItemInPlay(tableItem)) ? "true" : "false";
        if (tableContainer.dataset.hasLive !== hasLiveValue) {
            tableContainer.dataset.hasLive = hasLiveValue;
        }

        const hasDeltaValue = tableList.some(tableItem => Boolean(tableItem?.has_started)) ? "true" : "false";
        if (tableContainer.dataset.hasDelta !== hasDeltaValue) {
            tableContainer.dataset.hasDelta = hasDeltaValue;
        }
    }

    const seasonKey = tbody.dataset.seasonKey || "";

    const currentRows = getTableRows();
    const rowsByTeamId = new Map();
    currentRows.forEach(row => {
        const teamId = row.dataset.teamId;
        if (teamId) {
            rowsByTeamId.set(teamId, row);
        }
    });

    const desiredRows = [];
    let hasPositionChange = false;

    tableList.forEach(tableItem => {
        const teamId = String(tableItem.team.id);
        const row = rowsByTeamId.get(teamId);

        if (!row) {
            return;
        }

        if (row.dataset.position !== String(tableItem.position)) {
            hasPositionChange = true;
        }

        updateTableRow(row, tableItem, seasonKey, tableList.length);
        desiredRows.push(row);
    });

    const hasOrderMismatch = desiredRows.some((row, index) => currentRows[index] !== row);

    if (hasPositionChange || hasOrderMismatch) {
        const fragment = document.createDocumentFragment();
        desiredRows.forEach(row => fragment.appendChild(row));
        tbody.appendChild(fragment);
    }

    syncActiveRangeHighlight();
}

function renderLiveTable(tableList) {
    patchLiveTable(tableList);
}

function sendTableRefreshMessage() {
    if (!footballTableSocket || footballTableSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    footballTableSocket.send(JSON.stringify({ messageType: "get_table" }));
}

function ensureTableSocketAndRefresh() {
    if (!footballTableSocket || footballTableSocket.readyState === WebSocket.CLOSED) {
        openTableWebSocket();
        return;
    }

    if (footballTableSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    sendTableRefreshMessage();
}

function openTableWebSocket() {
    if (!footballTableUrl) {
        return;
    }

    footballTableSocket = new WebSocket(footballTableUrl);

    footballTableSocket.onmessage = event => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.error("Unable to parse live table payload", error);
            return;
        }

        renderLiveTable(payload.table_list);
    };

    footballTableSocket.addEventListener("open", () => {
        if (footballTableIntervalId !== null) {
            clearInterval(footballTableIntervalId);
        }

        footballTableIntervalId = setInterval(
            ensureTableSocketAndRefresh,
            FOOTBALL_TABLE_REFRESH_INTERVAL_MS
        );

        sendTableRefreshMessage();
    });
}

function getDayKey(dateValue) {
    return `${dateValue.getFullYear()}-${dateValue.getMonth()}-${dateValue.getDate()}`;
}

function hasTableDayChangedSinceLoad() {
    if (!footballTableLoadedDayKey) {
        footballTableLoadedDayKey = getDayKey(new Date());
        return false;
    }

    return getDayKey(new Date()) !== footballTableLoadedDayKey;
}

document.addEventListener("readystatechange", event => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        return;
    }

    const pageUrl = new URL(window.location.href);
    const wsProtocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
    footballTableUrl = `${wsProtocol}//${pageUrl.host}${footballTableBasePath}/ws/table/${pageUrl.search}`;
    footballTableLoadedDayKey = getDayKey(new Date());

    setupRangeInteractions();
    openTableWebSocket();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
        return;
    }

    if (hasTableDayChangedSinceLoad()) {
        window.location.reload();
        return;
    }

    ensureTableSocketAndRefresh();
});
