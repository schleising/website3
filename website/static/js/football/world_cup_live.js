let worldCupSocket = null;
let worldCupSocketUrl = null;
let worldCupIntervalId = null;
let worldCupShouldPoll = false;
let worldCupHasHydratedFullWindow = false;
let worldCupLoadedDayKey = null;
let worldCupEdition = "";
let worldCupIsAllMatchesView = false;

let worldCupLastInPlayAt = 0;

let worldCupTournamentTimeZone = "America/Los_Angeles";

const WORLD_CUP_POLL_GRACE_MS = 5 * 60 * 1000;
const WORLD_CUP_STATUS_RANK = {
    SCHEDULED: 1,
    TIMED: 1,
    AWARDED: 1,
    IN_PLAY: 2,
    PAUSED: 2,
    SUSPENDED: 2,
    FINISHED: 3,
};

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
        noteWorldCupLiveActivity(matches);
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

    if (!shouldApplyWorldCupMatchUpdate(scoreWidget, match)) {
        return;
    }

    const statusElement =
        scoreWidget.querySelector(".world-cup-match-status-text") ||
        scoreWidget.getElementsByClassName("match-status")[0];
    const homeElement = scoreWidget.getElementsByClassName("home-team-score")[0];
    const awayElement = scoreWidget.getElementsByClassName("away-team-score")[0];

    if (!statusElement || !homeElement || !awayElement) {
        return;
    }

    statusElement.textContent = formatWorldCupMatchStatus(match);
    const [homeScore, awayScore] = worldCupDisplayScore(match);
    homeElement.textContent = homeScore ?? "-";
    awayElement.textContent = awayScore ?? "-";

    const annotationElement = scoreWidget.querySelector(".world-cup-score-annotation");
    const annotation = worldCupScoreAnnotation(match);
    if (annotationElement) {
        annotationElement.textContent = annotation ?? "";
        annotationElement.hidden = !annotation;
    }

    scoreWidget.dataset.matchFinished = match.status === "FINISHED" ? "true" : "false";
    scoreWidget.dataset.matchLive =
        match.status === "IN_PLAY" || match.status === "PAUSED" ? "true" : "false";
}

function worldCupScoreUsesApiExtraTimeFormat(score) {
    const regularTime = score?.regular_time;
    if (regularTime?.home != null && regularTime?.away != null) {
        return true;
    }

    const homeFt = score?.full_time?.home;
    const awayFt = score?.full_time?.away;
    if (homeFt == null || awayFt == null) {
        return false;
    }

    if (score.duration === "PENALTY_SHOOTOUT" && homeFt !== awayFt) {
        return true;
    }

    if (score.duration === "EXTRA_TIME" && homeFt !== awayFt) {
        return true;
    }

    return false;
}

function worldCupNinetyMinuteScoreline(score) {
    if (worldCupScoreUsesApiExtraTimeFormat(score)) {
        const regularTime = score?.regular_time;
        if (regularTime?.home != null && regularTime?.away != null) {
            return [regularTime.home, regularTime.away];
        }
    }

    return [score?.full_time?.home ?? null, score?.full_time?.away ?? null];
}

function worldCupPostExtraTimeScoreline(score) {
    if (worldCupScoreUsesApiExtraTimeFormat(score)) {
        if (score.duration === "PENALTY_SHOOTOUT") {
            const regularTime = score?.regular_time;
            if (regularTime?.home != null && regularTime?.away != null) {
                let homeTotal = regularTime.home;
                let awayTotal = regularTime.away;
                const extraTime = score.extra_time;
                if (extraTime?.home != null && extraTime?.away != null) {
                    homeTotal += extraTime.home;
                    awayTotal += extraTime.away;
                }
                return [homeTotal, awayTotal];
            }

            const homeFt = score?.full_time?.home;
            const awayFt = score?.full_time?.away;
            if (homeFt != null && awayFt != null && homeFt === awayFt) {
                return [homeFt, awayFt];
            }
            return [null, null];
        }

        return [score?.full_time?.home ?? null, score?.full_time?.away ?? null];
    }

    const extraTime = score?.extra_time;
    if (extraTime?.home != null && extraTime?.away != null) {
        return [extraTime.home, extraTime.away];
    }

    return [score?.full_time?.home ?? null, score?.full_time?.away ?? null];
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
        return worldCupPostExtraTimeScoreline(score);
    }

    return [homeFt, awayFt];
}

function worldCupScoreAnnotation(match) {
    const score = match?.score;
    const homeScore = score?.full_time?.home;
    const awayScore = score?.full_time?.away;
    if (homeScore == null || awayScore == null) {
        return null;
    }

    const penalties = score?.penalties;
    if (penalties?.home != null && penalties?.away != null) {
        return `(${penalties.home}-${penalties.away} pens)`;
    }

    const [home90, away90] = worldCupNinetyMinuteScoreline(score);
    if (home90 == null || away90 == null || home90 !== away90) {
        return null;
    }

    const [postEtHome, postEtAway] = worldCupDisplayScore(match);
    if (postEtHome != null && postEtAway != null && postEtHome !== postEtAway) {
        return "(aet)";
    }

    return null;
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

function worldCupStatusRank(status) {
    return WORLD_CUP_STATUS_RANK[status] ?? 0;
}

function shouldApplyWorldCupMatchUpdate(scoreWidget, match) {
    if (!scoreWidget || !match) {
        return true;
    }

    const wasFinished = scoreWidget.dataset.matchFinished === "true";
    const wasLive = scoreWidget.dataset.matchLive === "true";
    const incomingRank = worldCupStatusRank(match.status);

    if (wasFinished && incomingRank < WORLD_CUP_STATUS_RANK.FINISHED) {
        return false;
    }

    if (wasLive && incomingRank < WORLD_CUP_STATUS_RANK.IN_PLAY) {
        return false;
    }

    return true;
}

function noteWorldCupLiveActivity(matchList) {
    if (
        matchList.some(
            (match) => match.status === "IN_PLAY" || match.status === "PAUSED"
        )
    ) {
        worldCupLastInPlayAt = Date.now();
    }
}

function hasWorldCupLiveWidgetsOnPage() {
    return Boolean(
        document.querySelector('.world-cup-score-widget[data-match-live="true"]')
    );
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

    if (
        matchList.some(
            (match) => refreshStatuses.has(match.status) && isWorldCupTodayMatch(match)
        )
    ) {
        return true;
    }

    if (Date.now() - worldCupLastInPlayAt < WORLD_CUP_POLL_GRACE_MS) {
        return true;
    }

    return hasWorldCupLiveWidgetsOnPage();
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

    const rawDate = match.utc_date || match.local_date;
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
