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
