let worldCupStandingsSocket = null;
let worldCupStandingsUrl;
let worldCupStandingsIntervalId = null;

const WORLD_CUP_STANDINGS_REFRESH_INTERVAL_MS = 10000;

const worldCupStandingsHtmlElement = document.documentElement;
const worldCupStandingsBasePathRaw = String(worldCupStandingsHtmlElement.dataset.footballBasePath ?? "/football").trim();
const worldCupStandingsBasePath = worldCupStandingsBasePathRaw === "/" ? "" : worldCupStandingsBasePathRaw.replace(/\/+$/, "");

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

function worldCupPositionDisplayValue(tableItem) {
    if (tableItem.position_label) {
        return tableItem.position_label;
    }
    return tableItem.position;
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

function updateGroupTableRow(row, tableItem) {
    row.dataset.position = String(tableItem.position);
    row.dataset.played = String(tableItem.played_games);
    row.dataset.points = String(tableItem.points);

    updateTextIfChanged(
        row.querySelector(".table-position-value"),
        worldCupPositionDisplayValue(tableItem)
    );
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
}

function patchGroupTable(group) {
    const container = document.querySelector(
        `.world-cup-table-container[data-group-slug="${group.group_slug}"]`
    );
    if (!container || !Array.isArray(group.table)) {
        return;
    }

    const hasLiveValue = group.table.some((tableItem) => isTableItemInPlay(tableItem)) ? "true" : "false";
    if (container.dataset.hasLive !== hasLiveValue) {
        container.dataset.hasLive = hasLiveValue;
    }

    const hasDeltaValue = group.table.some((tableItem) => Boolean(tableItem?.has_started)) ? "true" : "false";
    if (container.dataset.hasDelta !== hasDeltaValue) {
        container.dataset.hasDelta = hasDeltaValue;
    }

    const body = container.querySelector(".table-grid-body");
    if (!body) {
        return;
    }

    const rowsByTeamId = new Map();
    body.querySelectorAll(".data-row").forEach((row) => {
        const teamId = row.dataset.teamId;
        if (teamId) {
            rowsByTeamId.set(teamId, row);
        }
    });

    const desiredRows = [];
    let hasPositionChange = false;

    group.table.forEach((tableItem) => {
        const teamId = String(tableItem.team.id);
        const row = rowsByTeamId.get(teamId);
        if (!row) {
            return;
        }

        if (row.dataset.position !== String(tableItem.position)) {
            hasPositionChange = true;
        }

        updateGroupTableRow(row, tableItem);
        desiredRows.push(row);
    });

    const currentRows = Array.from(body.querySelectorAll(".data-row"));
    const hasOrderMismatch = desiredRows.some((row, index) => currentRows[index] !== row);

    if (hasPositionChange || hasOrderMismatch) {
        const fragment = document.createDocumentFragment();
        desiredRows.forEach((row) => fragment.appendChild(row));
        body.appendChild(fragment);
    }
}

function renderWorldCupStandings(payload) {
    if (!payload || !Array.isArray(payload.groups)) {
        return;
    }

    payload.groups.forEach((group) => {
        patchGroupTable(group);
    });
}

function sendWorldCupStandingsMessage() {
    if (!worldCupStandingsSocket || worldCupStandingsSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    worldCupStandingsSocket.send(JSON.stringify({ messageType: "get_world_cup_standings" }));
}

function ensureWorldCupStandingsSocketAndRefresh() {
    if (!worldCupStandingsSocket || worldCupStandingsSocket.readyState === WebSocket.CLOSED) {
        openWorldCupStandingsWebSocket();
        return;
    }

    if (worldCupStandingsSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    sendWorldCupStandingsMessage();
}

function openWorldCupStandingsWebSocket() {
    if (!worldCupStandingsUrl) {
        return;
    }

    worldCupStandingsSocket = new WebSocket(worldCupStandingsUrl);

    worldCupStandingsSocket.onmessage = (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.error("Unable to parse World Cup standings payload", error);
            return;
        }

        renderWorldCupStandings(payload);
    };

    worldCupStandingsSocket.addEventListener("open", () => {
        if (worldCupStandingsIntervalId !== null) {
            clearInterval(worldCupStandingsIntervalId);
        }

        worldCupStandingsIntervalId = setInterval(
            ensureWorldCupStandingsSocketAndRefresh,
            WORLD_CUP_STANDINGS_REFRESH_INTERVAL_MS
        );

        sendWorldCupStandingsMessage();
    });
}

document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const contentPad = document.querySelector(".football-content-pad");
    if (!contentPad || contentPad.dataset.worldCupStandingsLive !== "true") {
        return;
    }

    const hasStandings = document.querySelector(
        ".world-cup-table-container--live[data-group-slug]"
    );
    if (!hasStandings) {
        return;
    }

    const pageUrl = new URL(window.location.href);
    const wsProtocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
    worldCupStandingsUrl = `${wsProtocol}//${pageUrl.host}${worldCupStandingsBasePath}/ws/world-cup-table/${pageUrl.search}`;

    openWorldCupStandingsWebSocket();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
        return;
    }

    ensureWorldCupStandingsSocketAndRefresh();
});
