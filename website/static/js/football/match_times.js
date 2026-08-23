function parseKickoffUtc(isoString) {
    const raw = String(isoString || "").trim();
    if (raw === "") {
        return null;
    }

    // Datetime strings without a timezone are UTC kickoffs from the server.
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
    const normalized = hasTimezone ? raw : `${raw}Z`;
    const parsed = new Date(normalized);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMatchKickoff(isoString, format = "full") {
    const parsed = parseKickoffUtc(isoString);
    if (!parsed) {
        return "";
    }

    if (format === "time") {
        return parsed.toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
        });
    }

    if (format === "long") {
        return parsed.toLocaleString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
        });
    }

    return parsed.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    });
}

function localizeMatchStartElements(root = document) {
    for (const element of root.querySelectorAll("time.match-start[datetime]")) {
        const format = element.dataset.kickoffFormat || "full";
        element.textContent = formatMatchKickoff(element.getAttribute("datetime"), format);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    localizeMatchStartElements();
});

window.FootballMatchTimes = {
    formatMatchKickoff,
    localizeMatchStartElements,
    parseKickoffUtc,
};

const MATCH_STATUS_PILL_CLASSES = [
    "match-status--scheduled",
    "match-status--live",
    "match-status--paused",
    "match-status--finished",
    "match-status--suspended",
    "match-status--postponed",
    "match-status--cancelled",
    "match-status--penalties",
];

/**
 * Map an API match status (+ optional duration) to a status-pill CSS class.
 *
 * @param {string | null | undefined} status
 * @param {string | null | undefined} [duration]
 * @returns {string}
 */
function matchStatusPillClass(status, duration) {
    const statusValue = String(status || "")
        .trim()
        .toUpperCase()
        .replaceAll(" ", "_");
    const durationValue = String(duration || "").trim().toUpperCase();

    if (statusValue === "IN_PLAY") {
        if (durationValue === "PENALTY_SHOOTOUT") {
            return "match-status--penalties";
        }
        return "match-status--live";
    }
    if (statusValue === "PAUSED") {
        return "match-status--paused";
    }
    if (statusValue === "FINISHED") {
        return "match-status--finished";
    }
    if (statusValue === "SUSPENDED") {
        return "match-status--suspended";
    }
    if (statusValue === "POSTPONED") {
        return "match-status--postponed";
    }
    if (statusValue === "CANCELLED") {
        return "match-status--cancelled";
    }
    return "match-status--scheduled";
}

/**
 * Apply the coloured status-pill modifier to a match-status element.
 *
 * @param {Element | null | undefined} element
 * @param {string | null | undefined} status
 * @param {string | null | undefined} [duration]
 */
function applyMatchStatusPill(element, status, duration) {
    if (!(element instanceof Element)) {
        return;
    }

    MATCH_STATUS_PILL_CLASSES.forEach((className) => {
        element.classList.remove(className);
    });
    element.classList.add(matchStatusPillClass(status, duration));
}

window.FootballMatchStatus = {
    applyMatchStatusPill,
    matchStatusPillClass,
};
