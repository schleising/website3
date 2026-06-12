let worldCupSocket = null;
let worldCupSocketUrl = null;
let worldCupIntervalId = null;
let worldCupShouldPoll = false;
let worldCupHasHydratedFullWindow = false;
let worldCupLoadedDayKey = null;
let worldCupEdition = "";
let worldCupIsAllMatchesView = false;

let worldCupTournamentTimeZone = "America/Los_Angeles";

const worldCupHtmlElement = document.documentElement;
const worldCupBasePathRaw = String(worldCupHtmlElement.dataset.footballBasePath ?? "/football").trim();
const worldCupBasePath = worldCupBasePathRaw === "/" ? "" : worldCupBasePathRaw.replace(/\/+$/, "");
const worldCupWebSocketPath = `${worldCupBasePath}/ws/`;

document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const contentPad = document.querySelector(".football-content-pad");
    if (!contentPad || contentPad.dataset.worldCupLive !== "true") {
        return;
    }

    worldCupTournamentTimeZone = String(
        contentPad.dataset.wcTournamentTz || "America/Los_Angeles"
    ).trim();
    worldCupEdition = String(contentPad.dataset.worldCupEdition || "").trim();
    worldCupIsAllMatchesView = contentPad.dataset.allMatchesView === "true";
    worldCupLoadedDayKey = getWorldCupDayKey(new Date());

    const pageUrl = new URL(window.location.href);
    const wsProtocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
    const editionQuery = worldCupEdition ? `?edition=${encodeURIComponent(worldCupEdition)}` : "";
    worldCupSocketUrl = `${wsProtocol}//${pageUrl.host}${worldCupWebSocketPath}${editionQuery}`;

    openWorldCupWebSocket();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
        return;
    }

    if (hasWorldCupDayChangedSinceLoad()) {
        window.location.reload();
        return;
    }

    if (!worldCupSocket || worldCupSocket.readyState === WebSocket.CLOSED) {
        openWorldCupWebSocket();
        return;
    }

    if (worldCupSocket.readyState === WebSocket.OPEN) {
        sendWorldCupMessage(true);
    }
});

function openWorldCupWebSocket() {
    if (!worldCupSocketUrl) {
        return;
    }

    worldCupSocket = new WebSocket(worldCupSocketUrl);

    worldCupSocket.onmessage = (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.error("Unable to parse World Cup live scores payload", error);
            return;
        }

        const matches = Array.isArray(payload?.matches) ? payload.matches : [];
        matches.forEach(updateWorldCupScoreWidget);
        worldCupShouldPoll = hasRefreshableWorldCupMatchToday(matches);
        syncWorldCupPollingInterval();
    };

    worldCupSocket.addEventListener("open", () => {
        worldCupShouldPoll = false;
        syncWorldCupPollingInterval();

        const shouldRequestCurrentDayOnly = !(worldCupIsAllMatchesView && !worldCupHasHydratedFullWindow);
        sendWorldCupMessage(shouldRequestCurrentDayOnly);
        worldCupHasHydratedFullWindow = true;
    });
}

function checkWorldCupSocketAndSendMessage() {
    if (!worldCupSocket || worldCupSocket.readyState !== WebSocket.OPEN) {
        openWorldCupWebSocket();
        return;
    }

    if (!worldCupShouldPoll) {
        return;
    }

    sendWorldCupMessage(true);
}

function sendWorldCupMessage(currentDayOnly) {
    if (!worldCupSocket || worldCupSocket.readyState !== WebSocket.OPEN) {
        return;
    }

    const message = {
        messageType: "get_scores",
        competition: "world-cup",
        currentDayOnly: currentDayOnly !== false,
    };

    if (worldCupEdition) {
        message.edition = worldCupEdition;
    }

    worldCupSocket.send(JSON.stringify(message));
}

function updateWorldCupScoreWidget(match) {
    const scoreWidget = document.getElementById(String(match.id));
    if (!scoreWidget) {
        return;
    }

    const statusElement = scoreWidget.getElementsByClassName("match-status")[0];
    const homeElement = scoreWidget.getElementsByClassName("home-team-score")[0];
    const awayElement = scoreWidget.getElementsByClassName("away-team-score")[0];

    if (!statusElement || !homeElement || !awayElement) {
        return;
    }

    statusElement.textContent = formatWorldCupMatchStatus(match);
    const [homeScore, awayScore] = worldCupDisplayScore(match);
    homeElement.textContent = homeScore ?? "-";
    awayElement.textContent = awayScore ?? "-";
}

function worldCupMatchWentToExtraTime(score) {
    if (!score) {
        return false;
    }

    if (score.duration === "EXTRA_TIME" || score.duration === "PENALTY_SHOOTOUT") {
        return true;
    }

    const penalties = score.penalties;
    if (penalties?.home != null && penalties?.away != null) {
        return true;
    }

    const extraTime = score.extra_time;
    return extraTime?.home != null && extraTime?.away != null;
}

function worldCupDisplayScore(match) {
    const score = match?.score;
    const homeFt = score?.full_time?.home;
    const awayFt = score?.full_time?.away;

    if (homeFt == null || awayFt == null) {
        return [homeFt ?? null, awayFt ?? null];
    }

    if (worldCupMatchWentToExtraTime(score)) {
        const extraTime = score.extra_time;
        if (extraTime?.home != null && extraTime?.away != null) {
            return [extraTime.home, extraTime.away];
        }
    }

    return [homeFt, awayFt];
}

function formatWorldCupMatchStatus(match) {
    switch (match.status) {
        case "SCHEDULED":
        case "TIMED":
        case "AWARDED":
            return "Not Started";
        case "IN_PLAY":
            if (match.minute != null) {
                let status = `${match.minute}'`;
                if (match.injury_time != null) {
                    status = `${match.minute}+${match.injury_time}'`;
                }
                return status;
            }
            return "In Play";
        case "PAUSED":
            return "Half Time";
        case "FINISHED":
            return "Full Time";
        case "SUSPENDED":
            return "Suspended";
        case "POSTPONED":
            return "Postponed";
        case "CANCELLED":
            return "Cancelled";
        default:
            return String(match.status || "");
    }
}

function hasRefreshableWorldCupMatchToday(matchList) {
    const refreshStatuses = new Set([
        "SCHEDULED",
        "TIMED",
        "AWARDED",
        "IN_PLAY",
        "PAUSED",
        "SUSPENDED",
    ]);

    return matchList.some((match) => refreshStatuses.has(match.status) && isWorldCupTodayMatch(match));
}

function getWorldCupDateKeyInTournamentTimeZone(dateValue) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: worldCupTournamentTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(dateValue);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
}

function isWorldCupTodayMatch(match) {
    if (!match || typeof match !== "object") {
        return false;
    }

    const rawDate = match.local_date || match.utc_date;
    if (!rawDate) {
        return false;
    }

    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) {
        return false;
    }

    return getWorldCupDateKeyInTournamentTimeZone(parsedDate)
        === getWorldCupDateKeyInTournamentTimeZone(new Date());
}

function syncWorldCupPollingInterval() {
    if (worldCupShouldPoll) {
        if (worldCupIntervalId == null) {
            worldCupIntervalId = setInterval(checkWorldCupSocketAndSendMessage, 1000);
        }
        return;
    }

    if (worldCupIntervalId != null) {
        clearInterval(worldCupIntervalId);
        worldCupIntervalId = null;
    }
}

function getWorldCupDayKey(dateValue) {
    return getWorldCupDateKeyInTournamentTimeZone(dateValue);
}

function hasWorldCupDayChangedSinceLoad() {
    if (!worldCupLoadedDayKey) {
        worldCupLoadedDayKey = getWorldCupDayKey(new Date());
        return false;
    }

    return getWorldCupDayKey(new Date()) !== worldCupLoadedDayKey;
}
