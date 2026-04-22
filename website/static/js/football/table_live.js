let footballTableSocket = null;
let footballTableUrl;
let footballTableIntervalId = null;
let selectedTeamId = null;
let hoveredTeamId = null;
let footballTableLoadedDayKey = null;
let lastInteractionPointerType = "mouse";

const FOOTBALL_TABLE_REFRESH_INTERVAL_MS = 10000;
const FOOTBALL_MATCH_POPUP_CACHE_TTL_MS = 15000;
const FOOTBALL_MATCH_POPUP_HIDE_DELAY_MS = 140;
const FOOTBALL_MATCH_POPUP_EDGE_MARGIN_PX = 10;
const FOOTBALL_MATCH_POPUP_GAP_PX = 3;
const FOOTBALL_MATCH_POPUP_HORIZONTAL_GAP_PX = 6;
const FOOTBALL_MATCH_POPUP_FALLBACK_HEIGHT_PX = 190;
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
const POPUP_ELIGIBLE_MATCH_STATUSES = new Set([
    "IN_PLAY",
    "PAUSED",
    "IN PLAY",
    "HALF TIME",
    "FINISHED",
    "FULL TIME",
    "SUSPENDED",
    "AWARDED",
]);

let liveMatchPopupElement = null;
let liveMatchPopupCardElement = null;
let liveMatchPopupAnchor = null;
let liveMatchPopupPinned = false;
let liveMatchPopupHideTimerId = null;
let liveMatchPopupFetchPromise = null;
let liveMatchPopupMatches = [];
let liveMatchPopupLastLoadedAt = 0;

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
        const hasStartedMatchChip = tableItem?.has_started === true;
        deltaElement.dataset.liveMatch = hasStartedMatchChip ? "true" : "false";
        if (hasStartedMatchChip) {
            deltaElement.setAttribute("role", "button");
            deltaElement.setAttribute("tabindex", "0");
            deltaElement.setAttribute("aria-label", "Show match details");
            deltaElement.classList.add("is-live-match-chip");
        } else {
            deltaElement.removeAttribute("role");
            deltaElement.removeAttribute("tabindex");
            deltaElement.removeAttribute("aria-label");
            deltaElement.classList.remove("is-live-match-chip");
        }
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

function getInPlayOutcomePointAdjustment(cssClass) {
    const normalizedClass = typeof cssClass === "string" ? cssClass : "";

    if (normalizedClass.includes("winning")) {
        return 3;
    }

    if (normalizedClass.includes("drawing")) {
        return 1;
    }

    return 0;
}

function setRowPreGameData(row, tableItem) {
    const normalizeNumeric = value => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const isInPlay = isTableItemInPlay(tableItem);
    const cssClass = typeof tableItem?.css_class === "string" ? tableItem.css_class : "";

    const playedNow = normalizeNumeric(tableItem?.played_games);
    const pointsNow = normalizeNumeric(tableItem?.points);

    if (!isInPlay) {
        row.dataset.basePlayed = String(playedNow);
        row.dataset.basePoints = String(pointsNow);
        return;
    }

    const basePlayed = Math.max(0, playedNow - 1);
    const basePoints = Math.max(0, pointsNow - getInPlayOutcomePointAdjustment(cssClass));

    row.dataset.basePlayed = String(basePlayed);
    row.dataset.basePoints = String(basePoints);
}

function updateTableRow(row, tableItem, seasonKey, teamCount) {
    row.dataset.position = String(tableItem.position);
    row.dataset.played = String(tableItem.played_games);
    row.dataset.points = String(tableItem.points);
    setRowPreGameData(row, tableItem);

    updateSeasonZoneClasses(row, Number(tableItem.position), teamCount);

    const positionDisplayValue = tableItem.position_label || tableItem.position;
    updateTextIfChanged(row.querySelector(".table-position-value"), positionDisplayValue);
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

function getRowCalculationPoints(row) {
    const basePoints = String(row?.dataset?.basePoints || "").trim();
    if (basePoints !== "") {
        return asNumber(basePoints);
    }

    return asNumber(row?.dataset?.points);
}

function getRowCalculationPlayed(row) {
    const basePlayed = String(row?.dataset?.basePlayed || "").trim();
    if (basePlayed !== "") {
        return asNumber(basePlayed);
    }

    return asNumber(row?.dataset?.played);
}

function primeRowPreGameDataFromDom(row) {
    if (!(row instanceof HTMLElement)) {
        return;
    }

    const pointsNow = asNumber(row.dataset.points);
    const playedNow = asNumber(row.dataset.played);

    const isInPlay = row.querySelector(".live-indicator-dot") !== null;
    if (!isInPlay) {
        row.dataset.basePoints = String(pointsNow);
        row.dataset.basePlayed = String(playedNow);
        return;
    }

    const deltaElement = row.querySelector(".table-position-delta");
    const cssClass = deltaElement instanceof HTMLElement ? deltaElement.className : "";

    const basePoints = Math.max(0, pointsNow - getInPlayOutcomePointAdjustment(cssClass));
    const basePlayed = Math.max(0, playedNow - 1);

    row.dataset.basePoints = String(basePoints);
    row.dataset.basePlayed = String(basePlayed);
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
    const activePoints = getRowCalculationPoints(activeRow);
    const activePlayed = getRowCalculationPlayed(activeRow);
    const activeMaxPoints = activePoints + Math.max(0, totalGames - activePlayed) * 3;
    const activeMinPoints = activePoints;

    const highestPossiblePosition =
        1 + rows.filter(row => row !== activeRow && getRowCalculationPoints(row) > activeMaxPoints).length;

    const lowestPossiblePosition =
        1 + rows.filter(row => {
            if (row === activeRow) {
                return false;
            }

            const otherPoints = getRowCalculationPoints(row);
            const otherPlayed = getRowCalculationPlayed(row);
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

    getTableRows().forEach(primeRowPreGameDataFromDom);

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

        if (getLiveMatchChipFromTarget(event.target)) {
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

function normalizeTeamShortName(value) {
    return String(value || "").trim().toLowerCase();
}

function getSeasonQueryForTablePage() {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        return "";
    }

    return buildSeasonQuery(String(tbody.dataset.seasonKey || "").trim());
}

function createLiveMatchPopupElements() {
    if (liveMatchPopupElement && liveMatchPopupCardElement) {
        return;
    }

    liveMatchPopupElement = document.createElement("div");
    liveMatchPopupElement.className = "live-match-popup";
    liveMatchPopupElement.hidden = true;

    liveMatchPopupCardElement = document.createElement("article");
    liveMatchPopupCardElement.className = "score-widget site-card live-match-popup-card";
    liveMatchPopupElement.appendChild(liveMatchPopupCardElement);

    liveMatchPopupElement.addEventListener("mouseenter", () => {
        cancelLiveMatchPopupHide();
    });

    liveMatchPopupElement.addEventListener("mouseleave", () => {
        if (liveMatchPopupPinned) {
            return;
        }
        scheduleLiveMatchPopupHide();
    });

    document.body.appendChild(liveMatchPopupElement);
}

function getLiveMatchChipFromTarget(target) {
    if (!(target instanceof Element)) {
        return null;
    }

    return target.closest(".table-position-delta[data-live-match=\"true\"]");
}

function getRowTeamName(row) {
    if (!(row instanceof HTMLElement)) {
        return "";
    }

    const teamLink = row.querySelector(".team-name");
    if (!(teamLink instanceof HTMLElement)) {
        return "";
    }

    return String(teamLink.textContent || "").trim();
}

function formatLiveMatchStatus(statusValue) {
    const status = String(statusValue || "").trim().toUpperCase();
    if (status === "IN_PLAY") {
        return "In Play";
    }
    if (status === "IN PLAY") {
        return "In Play";
    }
    if (status === "PAUSED") {
        return "Half Time";
    }
    if (status === "HALF TIME") {
        return "Half Time";
    }
    if (status === "SUSPENDED") {
        return "Suspended";
    }
    if (status === "FINISHED" || status === "FULL TIME") {
        return "Full Time";
    }
    return status === "" ? "Live" : status;
}

function normalizeMatchStatus(statusValue) {
    const status = String(statusValue || "").trim().toUpperCase();
    return status.replaceAll("_", " ");
}

function isPopupEligibleMatchStatus(statusValue) {
    const normalizedStatus = normalizeMatchStatus(statusValue);
    return POPUP_ELIGIBLE_MATCH_STATUSES.has(normalizedStatus);
}

function matchStatusPriority(statusValue) {
    const normalizedStatus = normalizeMatchStatus(statusValue);

    if (normalizedStatus === "IN PLAY" || normalizedStatus === "PAUSED" || normalizedStatus === "HALF TIME") {
        return 0;
    }

    if (normalizedStatus === "SUSPENDED") {
        return 1;
    }

    if (normalizedStatus === "FINISHED" || normalizedStatus === "FULL TIME" || normalizedStatus === "AWARDED") {
        return 2;
    }

    return 3;
}

function parseStartTimeMs(startTimeIso) {
    const parsedMs = Date.parse(String(startTimeIso || ""));
    return Number.isNaN(parsedMs) ? Number.NEGATIVE_INFINITY : parsedMs;
}

function formatLiveMatchStart(startTimeIso) {
    const parsedDate = new Date(String(startTimeIso || ""));
    if (Number.isNaN(parsedDate.getTime())) {
        return "Kickoff";
    }

    return parsedDate.toLocaleString(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    });
}

function positionLiveMatchPopup(anchorElement) {
    if (!liveMatchPopupElement || !anchorElement) {
        return;
    }

    const margin = FOOTBALL_MATCH_POPUP_EDGE_MARGIN_PX;
    const gap = FOOTBALL_MATCH_POPUP_GAP_PX;
    const horizontalGap = FOOTBALL_MATCH_POPUP_HORIZONTAL_GAP_PX;
    const anchorRect = anchorElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popupRect = liveMatchPopupElement.getBoundingClientRect();
    const popupWidth = Math.max(Math.round(popupRect.width), 1);
    const measuredPopupHeight = Math.round(popupRect.height);
    const popupHeight = measuredPopupHeight > 0
        ? measuredPopupHeight
        : FOOTBALL_MATCH_POPUP_FALLBACK_HEIGHT_PX;

    // Prefer placing the popup just to the right of the live score chip.
    const preferredRightLeft = anchorRect.right + horizontalGap;
    const preferredLeftLeft = anchorRect.left - popupWidth - horizontalGap;
    const maxLeft = viewportWidth - popupWidth - margin;

    let left = preferredRightLeft;
    if (left > maxLeft) {
        left = preferredLeftLeft;
    }
    left = Math.max(margin, Math.min(left, maxLeft));

    const availableAbove = anchorRect.top - margin;
    const availableBelow = viewportHeight - anchorRect.bottom - margin;
    const fitsAbove = availableAbove >= (popupHeight + gap);
    const fitsBelow = availableBelow >= (popupHeight + gap);

    let placeAbove = true;
    if (!fitsAbove && fitsBelow) {
        placeAbove = false;
    } else if (!fitsAbove && !fitsBelow) {
        placeAbove = availableAbove >= availableBelow;
    }

    // On touch, keep the popup away from the finger whenever there is space above.
    if (lastInteractionPointerType === "touch" && fitsAbove) {
        placeAbove = true;
    }

    const preferredTop = placeAbove
        ? anchorRect.top - popupHeight - gap
        : anchorRect.bottom + gap;
    const clampedTop = Math.max(
        margin,
        Math.min(preferredTop, viewportHeight - popupHeight - margin)
    );

    liveMatchPopupElement.style.left = `${Math.round(left)}px`;
    liveMatchPopupElement.style.top = `${Math.round(clampedTop)}px`;
}

function renderLiveMatchPopupCard(matchData) {
    if (!liveMatchPopupCardElement) {
        return;
    }

    if (!matchData) {
        liveMatchPopupCardElement.innerHTML = `
            <div class="date-and-time">
                <div class="match-start">Live Match</div>
                <div class="match-status">Unavailable</div>
            </div>
            <div class="team">
                <div class="team-and-badge">
                    <span class="team-name">Match details are loading.</span>
                </div>
                <div class="home-team-score">-</div>
            </div>
            <div class="team">
                <div class="team-and-badge">
                    <span class="team-name">Please try again.</span>
                </div>
                <div class="away-team-score">-</div>
            </div>
        `;
        return;
    }

    const homeScore = matchData.home_team_score ?? "-";
    const awayScore = matchData.away_team_score ?? "-";
    const statusText = formatLiveMatchStatus(matchData.status);
    const kickoffText = formatLiveMatchStart(matchData.start_time_iso);

    liveMatchPopupCardElement.innerHTML = `
        <div class="date-and-time">
            <div class="match-start">${escapeHtml(kickoffText)}</div>
            <div class="match-status">${escapeHtml(statusText)}</div>
        </div>
        <div class="team">
            <div class="team-and-badge">
                <span class="team-name">${escapeHtml(matchData.home_team)}</span>
            </div>
            <div class="home-team-score">${escapeHtml(homeScore)}</div>
        </div>
        <div class="team">
            <div class="team-and-badge">
                <span class="team-name">${escapeHtml(matchData.away_team)}</span>
            </div>
            <div class="away-team-score">${escapeHtml(awayScore)}</div>
        </div>
    `;
}

async function ensureLiveMatchPopupMatches(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && (now - liveMatchPopupLastLoadedAt) < FOOTBALL_MATCH_POPUP_CACHE_TTL_MS) {
        return liveMatchPopupMatches;
    }

    if (liveMatchPopupFetchPromise) {
        return liveMatchPopupFetchPromise;
    }

    const seasonQuery = getSeasonQueryForTablePage();
    const url = `${footballTableRootPath}api/${seasonQuery}`;

    liveMatchPopupFetchPromise = fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
            "Accept": "application/json",
        },
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Live match details request failed: ${response.status}`);
            }
            return response.json();
        })
        .then(payload => {
            const matches = Array.isArray(payload?.matches) ? payload.matches : [];
            liveMatchPopupMatches = matches.filter(match => isPopupEligibleMatchStatus(match?.status));
            liveMatchPopupLastLoadedAt = Date.now();
            return liveMatchPopupMatches;
        })
        .catch(error => {
            console.error(error);
            liveMatchPopupMatches = [];
            return liveMatchPopupMatches;
        })
        .finally(() => {
            liveMatchPopupFetchPromise = null;
        });

    return liveMatchPopupFetchPromise;
}

function findLiveMatchByTeamName(teamName) {
    const normalizedTeamName = normalizeTeamShortName(teamName);
    if (normalizedTeamName === "") {
        return null;
    }

    const matchingMatches = liveMatchPopupMatches.filter(match => {
        const homeName = normalizeTeamShortName(match?.home_team);
        const awayName = normalizeTeamShortName(match?.away_team);
        return homeName === normalizedTeamName || awayName === normalizedTeamName;
    });

    if (matchingMatches.length === 0) {
        return null;
    }

    matchingMatches.sort((a, b) => {
        const statusDelta = matchStatusPriority(a?.status) - matchStatusPriority(b?.status);
        if (statusDelta !== 0) {
            return statusDelta;
        }

        // For equal status buckets, prefer the most recent kickoff.
        return parseStartTimeMs(b?.start_time_iso) - parseStartTimeMs(a?.start_time_iso);
    });

    return matchingMatches[0] || null;
}

function cancelLiveMatchPopupHide() {
    if (liveMatchPopupHideTimerId !== null) {
        window.clearTimeout(liveMatchPopupHideTimerId);
        liveMatchPopupHideTimerId = null;
    }
}

function hideLiveMatchPopup() {
    cancelLiveMatchPopupHide();

    if (!liveMatchPopupElement) {
        return;
    }

    liveMatchPopupElement.hidden = true;
    liveMatchPopupAnchor = null;
    liveMatchPopupPinned = false;
}

function scheduleLiveMatchPopupHide() {
    cancelLiveMatchPopupHide();
    liveMatchPopupHideTimerId = window.setTimeout(() => {
        hideLiveMatchPopup();
    }, FOOTBALL_MATCH_POPUP_HIDE_DELAY_MS);
}

async function showLiveMatchPopup(anchorElement, options = {}) {
    if (!(anchorElement instanceof HTMLElement)) {
        return;
    }

    const persistent = options.persistent === true;
    const forceRefresh = options.forceRefresh === true;

    createLiveMatchPopupElements();
    cancelLiveMatchPopupHide();

    const row = anchorElement.closest(".data-row[data-team-id]");
    const teamName = getRowTeamName(row);

    liveMatchPopupAnchor = anchorElement;
    liveMatchPopupPinned = persistent;

    if (liveMatchPopupElement) {
        liveMatchPopupElement.hidden = false;
    }

    renderLiveMatchPopupCard(null);
    positionLiveMatchPopup(anchorElement);

    await ensureLiveMatchPopupMatches(forceRefresh);
    if (liveMatchPopupAnchor !== anchorElement) {
        return;
    }

    const liveMatch = findLiveMatchByTeamName(teamName);
    renderLiveMatchPopupCard(liveMatch);
    positionLiveMatchPopup(anchorElement);
}

function setupLiveMatchPopupInteractions() {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody) {
        return;
    }

    tbody.addEventListener("mouseover", event => {
        if (liveMatchPopupPinned) {
            return;
        }

        const chip = getLiveMatchChipFromTarget(event.target);
        if (!chip) {
            return;
        }

        if (lastInteractionPointerType === "touch") {
            return;
        }

        void showLiveMatchPopup(chip, { persistent: false, forceRefresh: false });
    });

    tbody.addEventListener("mouseout", event => {
        if (liveMatchPopupPinned) {
            return;
        }

        const chip = getLiveMatchChipFromTarget(event.target);
        if (!chip) {
            return;
        }

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node) {
            if (chip.contains(relatedTarget)) {
                return;
            }

            if (liveMatchPopupElement && liveMatchPopupElement.contains(relatedTarget)) {
                return;
            }
        }

        scheduleLiveMatchPopupHide();
    });

    tbody.addEventListener("click", event => {
        const chip = getLiveMatchChipFromTarget(event.target);
        if (!chip) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const isSameChip = liveMatchPopupPinned && liveMatchPopupAnchor === chip;
        if (isSameChip) {
            hideLiveMatchPopup();
            return;
        }

        void showLiveMatchPopup(chip, { persistent: true, forceRefresh: true });
    });

    tbody.addEventListener("keydown", event => {
        const chip = getLiveMatchChipFromTarget(event.target);
        if (!chip) {
            return;
        }

        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        const isSameChip = liveMatchPopupPinned && liveMatchPopupAnchor === chip;
        if (isSameChip) {
            hideLiveMatchPopup();
            return;
        }

        void showLiveMatchPopup(chip, { persistent: true, forceRefresh: true });
    });

    document.addEventListener("click", event => {
        if (!liveMatchPopupPinned) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
            hideLiveMatchPopup();
            return;
        }

        if (liveMatchPopupElement && liveMatchPopupElement.contains(target)) {
            return;
        }

        const chip = getLiveMatchChipFromTarget(target);
        if (chip && chip === liveMatchPopupAnchor) {
            return;
        }

        hideLiveMatchPopup();
    });

    window.addEventListener("scroll", () => {
        if (!liveMatchPopupElement || liveMatchPopupElement.hidden) {
            return;
        }

        if (!liveMatchPopupAnchor || !liveMatchPopupAnchor.isConnected) {
            hideLiveMatchPopup();
            return;
        }

        positionLiveMatchPopup(liveMatchPopupAnchor);
    }, { passive: true });

    window.addEventListener("resize", () => {
        if (!liveMatchPopupElement || liveMatchPopupElement.hidden) {
            return;
        }

        if (!liveMatchPopupAnchor || !liveMatchPopupAnchor.isConnected) {
            hideLiveMatchPopup();
            return;
        }

        positionLiveMatchPopup(liveMatchPopupAnchor);
    });
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

    if (
        liveMatchPopupAnchor
        && (!liveMatchPopupAnchor.isConnected || liveMatchPopupAnchor.dataset.liveMatch !== "true")
    ) {
        hideLiveMatchPopup();
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
    setupLiveMatchPopupInteractions();
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
