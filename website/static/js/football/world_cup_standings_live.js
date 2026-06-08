const WORLD_CUP_STANDINGS_REFRESH_INTERVAL_MS = 10000;

let worldCupStandingsSocket = null;
let worldCupStandingsSocketUrl = null;
let worldCupStandingsIntervalId = null;
let worldCupStandingsEdition = "";

const worldCupStandingsHtmlElement = document.documentElement;
const worldCupStandingsBasePathRaw = String(worldCupStandingsHtmlElement.dataset.footballBasePath ?? "/football").trim();
const worldCupStandingsBasePath = worldCupStandingsBasePathRaw === "/" ? "" : worldCupStandingsBasePathRaw.replace(/\/+$/, "");

document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const contentPad = document.querySelector(".football-content-pad");
    if (!contentPad || contentPad.dataset.worldCupStandingsLive !== "true") {
        return;
    }

    const hasStandings = document.querySelector(
        ".world-cup-overview-standings, .world-cup-table-container[data-group-slug]"
    );
    if (!hasStandings) {
        return;
    }

    worldCupStandingsEdition = String(contentPad.dataset.worldCupEdition || "").trim();

    const pageUrl = new URL(window.location.href);
    const wsProtocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
    const editionQuery = worldCupStandingsEdition
        ? `?edition=${encodeURIComponent(worldCupStandingsEdition)}`
        : "";
    worldCupStandingsSocketUrl = `${wsProtocol}//${pageUrl.host}${worldCupStandingsBasePath}/ws/${editionQuery}`;

    openWorldCupStandingsWebSocket();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
        return;
    }

    ensureWorldCupStandingsSocketAndRefresh();
});

function updateTextIfChanged(element, value) {
    if (!element) {
        return;
    }

    const safeValue = value === null || value === undefined ? "" : String(value);
    if (element.textContent !== safeValue) {
        element.textContent = safeValue;
    }
}

function worldCupPositionDisplayValue(tableItem) {
    if (tableItem.position_label) {
        return tableItem.position_label;
    }
    return tableItem.position;
}

function updateOverviewStandingsRow(row, tableItem) {
    row.dataset.position = String(tableItem.position);
    updateTextIfChanged(
        row.querySelector(".world-cup-overview-standings-position"),
        worldCupPositionDisplayValue(tableItem)
    );
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-played"), tableItem.played_games);
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-won"), tableItem.won);
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-draw"), tableItem.draw);
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-lost"), tableItem.lost);
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-goal-difference"), tableItem.goal_difference);
    updateTextIfChanged(row.querySelector(".world-cup-overview-standings-points"), tableItem.points);
}

function updateGroupTableRow(row, tableItem) {
    row.dataset.position = String(tableItem.position);
    updateTextIfChanged(
        row.querySelector(".table-position-value"),
        worldCupPositionDisplayValue(tableItem)
    );
    updateTextIfChanged(row.querySelector(".table-played"), tableItem.played_games);
    updateTextIfChanged(row.querySelector(".table-won"), tableItem.won);
    updateTextIfChanged(row.querySelector(".table-draw"), tableItem.draw);
    updateTextIfChanged(row.querySelector(".table-lost"), tableItem.lost);
    updateTextIfChanged(row.querySelector(".table-goals-for"), tableItem.goals_for);
    updateTextIfChanged(row.querySelector(".table-goals-against"), tableItem.goals_against);
    updateTextIfChanged(row.querySelector(".table-goal-difference"), tableItem.goal_difference);
    updateTextIfChanged(row.querySelector(".table-points"), tableItem.points);
}

function reorderRowsByPosition(container, rowSelector) {
    const rows = Array.from(container.querySelectorAll(rowSelector));
    if (rows.length < 2) {
        return;
    }

    const sortedRows = rows.slice().sort((left, right) => {
        const leftPosition = Number(left.dataset.position || 0);
        const rightPosition = Number(right.dataset.position || 0);
        return leftPosition - rightPosition;
    });

    const hasOrderMismatch = sortedRows.some((row, index) => rows[index] !== row);
    if (!hasOrderMismatch) {
        return;
    }

    const fragment = document.createDocumentFragment();
    sortedRows.forEach((row) => fragment.appendChild(row));
    container.appendChild(fragment);
}

function patchOverviewStandings(group) {
    const container = document.getElementById(`wc-standings-${group.group_slug}`);
    if (!container || !Array.isArray(group.table)) {
        return;
    }

    group.table.forEach((tableItem) => {
        const row = container.querySelector(`[data-team-id="${tableItem.team.id}"]`);
        if (!row) {
            return;
        }
        updateOverviewStandingsRow(row, tableItem);
    });

    reorderRowsByPosition(container, ".world-cup-overview-standings-row");
}

function patchGroupTable(group) {
    const container = document.querySelector(
        `.world-cup-table-container[data-group-slug="${group.group_slug}"]`
    );
    if (!container || !Array.isArray(group.table)) {
        return;
    }

    const body = container.querySelector(".table-grid-body");
    if (!body) {
        return;
    }

    group.table.forEach((tableItem) => {
        const row = body.querySelector(`[data-team-id="${tableItem.team.id}"]`);
        if (!row) {
            return;
        }
        updateGroupTableRow(row, tableItem);
    });

    reorderRowsByPosition(body, ".data-row");
}

function renderWorldCupStandings(payload) {
    const groups = Array.isArray(payload?.groups) ? payload.groups : [];
    groups.forEach((group) => {
        patchOverviewStandings(group);
        patchGroupTable(group);
    });
}

function sendWorldCupStandingsMessage() {
    if (!worldCupStandingsSocket || worldCupStandingsSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    const message = {
        messageType: "get_world_cup_standings",
    };

    if (worldCupStandingsEdition) {
        message.edition = worldCupStandingsEdition;
    }

    worldCupStandingsSocket.send(JSON.stringify(message));
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
    if (!worldCupStandingsSocketUrl) {
        return;
    }

    worldCupStandingsSocket = new WebSocket(worldCupStandingsSocketUrl);

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
