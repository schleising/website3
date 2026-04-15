let footballTableSocket = null;
let footballTableUrl;
let footballTableIntervalId = null;

const FOOTBALL_TABLE_REFRESH_INTERVAL_MS = 10000;

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

function updatePositionDelta(row, tableItem) {
    const positionCell = row.querySelector(".position");
    if (!positionCell) {
        return;
    }

    let deltaElement = positionCell.querySelector(".table-position-delta");

    if (tableItem.has_started) {
        if (!deltaElement) {
            deltaElement = document.createElement("div");
            deltaElement.classList.add("table-position-delta");
            positionCell.appendChild(deltaElement);
        }

        deltaElement.className = `table-position-delta ${tableItem.css_class || ""}`.trim();
        updateTextIfChanged(deltaElement, tableItem.score_string || "");
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
            .reverse()
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

    const expectedHref = `/football/matches/team/${teamId}/${buildSeasonQuery(seasonKey)}`;
    if (teamLinkElement.getAttribute("href") !== expectedHref) {
        teamLinkElement.setAttribute("href", expectedHref);
    }
}

function updateTableRow(row, tableItem, seasonKey) {
    updateTextIfChanged(row.querySelector(".table-position-value"), tableItem.position);
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

function patchLiveTable(tableList) {
    const tbody = document.getElementById("football-live-table-body");
    if (!tbody || !Array.isArray(tableList)) {
        return;
    }

    const tableContainer = tbody.closest(".table-container");
    if (tableContainer) {
        tableContainer.dataset.teamCount = String(tableList.length);
    }

    const seasonKey = tbody.dataset.seasonKey || "";

    tableList.forEach(tableItem => {
        const teamId = String(tableItem.team.id);
        const row = tbody.querySelector(`tr[data-team-id="${CSS.escape(teamId)}"]`);

        if (!row) {
            return;
        }

        updateTableRow(row, tableItem, seasonKey);
        tbody.appendChild(row);
    });
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
    footballTableUrl = `${wsProtocol}//${pageUrl.host}/football/ws/table/${pageUrl.search}`;

    openTableWebSocket();
});
