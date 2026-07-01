/**
 * Fill "Winner Match N" / "Loser Match N" slots from completed feeder results in the DOM.
 * API-confirmed teams always take precedence over client-side resolution.
 */

const WC_KNOCKOUT_CHRONO_ORDER = {
    LAST_32: [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
    LAST_16: [90, 89, 91, 92, 93, 94, 95, 96],
    QUARTER_FINALS: [97, 98, 99, 100],
    SEMI_FINALS: [101, 102],
    FINAL: [104],
    THIRD_PLACE: [103],
};

const WC_FEEDER_WINNER_MATCH_RE = /^winner\s+(?:of\s+)?match\s+(\d+)$/i;
const WC_FEEDER_LOSER_MATCH_RE = /^loser\s+(?:of\s+)?match\s+(\d+)$/i;

const worldCupKnockoutMatchCache = new Map();

function normalizeTeam(team) {
    if (!team || typeof team !== "object") {
        return { id: null, name: null, short_name: null, crest: null };
    }

    const shortName = team.short_name ?? team.shortName ?? team.name ?? null;
    return {
        id: team.id ?? null,
        name: team.name ?? shortName,
        short_name: shortName,
        shortName,
        crest: team.crest ?? null,
    };
}

function normalizeMatch(match) {
    const homeTeam = normalizeTeam(match.home_team ?? match.homeTeam);
    const awayTeam = normalizeTeam(match.away_team ?? match.awayTeam);
    const score = match.score ?? {};

    return {
        ...match,
        home_team: homeTeam,
        away_team: awayTeam,
        score: {
            ...score,
            full_time: {
                home: score.full_time?.home ?? score.fullTime?.home ?? null,
                away: score.full_time?.away ?? score.fullTime?.away ?? null,
            },
            penalties: score.penalties ?? null,
            regular_time: score.regular_time ?? score.regularTime ?? null,
            extra_time: score.extra_time ?? score.extraTime ?? null,
            duration: score.duration ?? "REGULAR",
        },
    };
}

function parseFeederFixtureFromTeam(team) {
    for (const field of ["name", "short_name", "shortName"]) {
        const value = team?.[field];
        if (value == null) {
            continue;
        }

        const candidate = String(value).trim();
        let match = WC_FEEDER_WINNER_MATCH_RE.exec(candidate);
        if (match) {
            return { fixture: Number.parseInt(match[1], 10), kind: "winner" };
        }

        match = WC_FEEDER_LOSER_MATCH_RE.exec(candidate);
        if (match) {
            return { fixture: Number.parseInt(match[1], 10), kind: "loser" };
        }
    }

    return null;
}

function isFeederPlaceholderTeam(team) {
    return parseFeederFixtureFromTeam(team) !== null;
}

function isConfirmedKnockoutTeam(team) {
    if (!team || team.id == null || team.id <= 0) {
        return false;
    }

    if (isFeederPlaceholderTeam(team)) {
        return false;
    }

    const label = String(team.short_name ?? team.shortName ?? team.name ?? "").trim();
    return label !== "" && label.toLowerCase() !== "tbd";
}

function knockoutStageForFixtureNumber(fixtureNumber) {
    if (fixtureNumber >= 73 && fixtureNumber <= 88) {
        return "LAST_32";
    }
    if (fixtureNumber >= 89 && fixtureNumber <= 96) {
        return "LAST_16";
    }
    if (fixtureNumber >= 97 && fixtureNumber <= 100) {
        return "QUARTER_FINALS";
    }
    if (fixtureNumber >= 101 && fixtureNumber <= 102) {
        return "SEMI_FINALS";
    }
    if (fixtureNumber === 103) {
        return "THIRD_PLACE";
    }
    if (fixtureNumber === 104) {
        return "FINAL";
    }
    return null;
}

function buildKnockoutFixtureMap(stage, matches) {
    const order = WC_KNOCKOUT_CHRONO_ORDER[stage];
    if (!order) {
        return {};
    }

    const stageMatches = matches
        .filter((match) => match.stage === stage)
        .sort((left, right) => new Date(left.utc_date) - new Date(right.utc_date));

    if (stageMatches.length !== order.length) {
        return {};
    }

    const mapping = {};
    order.forEach((fixtureNumber, index) => {
        mapping[fixtureNumber] = stageMatches[index];
    });
    return mapping;
}

function getKnockoutFixtureMaps(matches) {
    const maps = {};
    for (const stage of Object.keys(WC_KNOCKOUT_CHRONO_ORDER)) {
        maps[stage] = buildKnockoutFixtureMap(stage, matches);
    }
    return maps;
}

function getFeederMatchForFixture(fixtureNumber, matches) {
    const stage = knockoutStageForFixtureNumber(fixtureNumber);
    if (!stage) {
        return null;
    }

    const fixtureMaps = getKnockoutFixtureMaps(matches);
    return fixtureMaps[stage]?.[fixtureNumber] ?? null;
}

function knockoutWinnerSide(match) {
    if (!match || !["FINISHED", "AWARDED"].includes(match.status)) {
        return null;
    }

    const score = match.score;
    if (!score) {
        return null;
    }

    const penalties = score.penalties;
    if (penalties?.home != null && penalties?.away != null) {
        if (penalties.home > penalties.away) {
            return "home";
        }
        if (penalties.away > penalties.home) {
            return "away";
        }
        return null;
    }

    let homeScore;
    let awayScore;
    if (typeof worldCupDisplayScore === "function") {
        [homeScore, awayScore] = worldCupDisplayScore(match);
    } else {
        homeScore = score.full_time?.home ?? null;
        awayScore = score.full_time?.away ?? null;
    }

    if (homeScore == null || awayScore == null) {
        return null;
    }
    if (homeScore > awayScore) {
        return "home";
    }
    if (awayScore > homeScore) {
        return "away";
    }
    return null;
}

function knockoutWinnerTeam(match) {
    const side = knockoutWinnerSide(match);
    if (!side) {
        return null;
    }

    const team = side === "home" ? match.home_team : match.away_team;
    return isConfirmedKnockoutTeam(team) ? team : null;
}

function knockoutLoserTeam(match) {
    const side = knockoutWinnerSide(match);
    if (!side) {
        return null;
    }

    const team = side === "home" ? match.away_team : match.home_team;
    return isConfirmedKnockoutTeam(team) ? team : null;
}

function resolveFeederTeam(team, matches) {
    const feeder = parseFeederFixtureFromTeam(team);
    if (!feeder) {
        return isConfirmedKnockoutTeam(team) ? team : null;
    }

    const feederMatch = getFeederMatchForFixture(feeder.fixture, matches);
    if (!feederMatch) {
        return null;
    }

    if (feeder.kind === "loser") {
        return knockoutLoserTeam(feederMatch);
    }
    return knockoutWinnerTeam(feederMatch);
}

function parseScoreText(value) {
    const trimmed = String(value ?? "").trim();
    if (trimmed === "" || trimmed === "-") {
        return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function parseTeamFromElement(teamElement) {
    const nameElement = teamElement.querySelector(".team-name");
    const label = nameElement?.textContent?.trim() ?? "";
    const href = nameElement?.getAttribute("href") ?? "";
    const idMatch = href.match(/\/teams\/(\d+)\//);
    const badge = teamElement.querySelector(".team-badge");

    return {
        id: idMatch ? Number.parseInt(idMatch[1], 10) : null,
        name: label,
        short_name: label,
        shortName: label,
        crest: badge?.getAttribute("src") ?? null,
    };
}

function widgetStatusFromDom(widget) {
    if (widget.dataset.matchFinished === "true") {
        return "FINISHED";
    }
    if (widget.dataset.matchLive === "true") {
        return "IN_PLAY";
    }

    const statusText = widget.querySelector(".world-cup-match-status-text")?.textContent?.trim();
    switch (statusText) {
        case "Half Time":
            return "PAUSED";
        case "Full Time":
            return "FINISHED";
        case "Not Started":
            return "TIMED";
        default:
            return "TIMED";
    }
}

function parseMatchFromWidget(widget) {
    const matchId = Number.parseInt(widget.id, 10);
    if (Number.isNaN(matchId)) {
        return null;
    }

    const teamElements = widget.querySelectorAll(":scope > .team");
    if (teamElements.length < 2) {
        return null;
    }

    return normalizeMatch({
        id: matchId,
        stage: widget.dataset.matchStage ?? "",
        utc_date: widget.dataset.matchTime ?? "",
        status: widgetStatusFromDom(widget),
        home_team: parseTeamFromElement(teamElements[0]),
        away_team: parseTeamFromElement(teamElements[1]),
        score: {
            full_time: {
                home: parseScoreText(widget.querySelector(".home-team-score")?.textContent),
                away: parseScoreText(widget.querySelector(".away-team-score")?.textContent),
            },
            penalties: null,
            duration: "REGULAR",
        },
    });
}

function seedWorldCupKnockoutMatchCacheFromDom() {
    document.querySelectorAll(".world-cup-score-widget[id]").forEach((widget) => {
        const parsed = parseMatchFromWidget(widget);
        if (!parsed) {
            return;
        }

        const existing = worldCupKnockoutMatchCache.get(String(parsed.id));
        if (!existing) {
            worldCupKnockoutMatchCache.set(String(parsed.id), parsed);
            return;
        }

        if (existing.status !== "FINISHED" && parsed.status === "FINISHED") {
            worldCupKnockoutMatchCache.set(String(parsed.id), parsed);
        }
    });
}

function mergeWorldCupKnockoutMatches(matches) {
    if (!Array.isArray(matches)) {
        return;
    }

    for (const match of matches) {
        if (!match || match.id == null) {
            continue;
        }

        const normalized = normalizeMatch(match);
        const key = String(normalized.id);
        const existing = worldCupKnockoutMatchCache.get(key);

        if (!existing) {
            worldCupKnockoutMatchCache.set(key, normalized);
            continue;
        }

        const existingRank = worldCupStatusRank(existing.status);
        const incomingRank = worldCupStatusRank(normalized.status);
        if (incomingRank < existingRank) {
            continue;
        }

        worldCupKnockoutMatchCache.set(key, normalized);
    }

    seedWorldCupKnockoutMatchCacheFromDom();
}

function worldCupStatusRank(status) {
    switch (status) {
        case "FINISHED":
        case "AWARDED":
            return 3;
        case "IN_PLAY":
        case "PAUSED":
        case "SUSPENDED":
            return 2;
        default:
            return 1;
    }
}

function worldCupCrestUrl(team) {
    if (!team?.id) {
        return "/images/football/crests/unknown_team.svg";
    }
    if (team.crest) {
        return team.crest;
    }
    return `/images/football/crests/wc/${team.id}.svg`;
}

function teamDisplayLabel(team) {
    return String(team.short_name ?? team.shortName ?? team.name ?? "").trim();
}

function updateKnockoutTeamSlot(widget, side, team, edition) {
    const teamElements = widget.querySelectorAll(":scope > .team");
    const teamElement = teamElements[side === "home" ? 0 : 1];
    if (!teamElement) {
        return;
    }

    const label = teamDisplayLabel(team);
    const crestUrl = worldCupCrestUrl(team);
    const badge = teamElement.querySelector(".team-badge");
    const nameElement = teamElement.querySelector(".team-name");
    const footballRoot = String(document.documentElement.dataset.footballBasePath ?? "/football")
        .trim()
        .replace(/\/+$/, "");
    const footballPrefix = footballRoot === "" ? "/" : `${footballRoot}/`;

    if (badge) {
        badge.src = crestUrl;
        badge.alt = `${label} crest`;
    }

    if (team.id && isConfirmedKnockoutTeam(team)) {
        const href = `${footballPrefix}world-cup/teams/${team.id}/?edition=${encodeURIComponent(edition)}`;
        if (nameElement instanceof HTMLAnchorElement) {
            nameElement.href = href;
            nameElement.textContent = label;
        } else if (nameElement) {
            const link = document.createElement("a");
            link.className = "team-name";
            link.href = href;
            link.textContent = label;
            nameElement.replaceWith(link);
        }
        teamElement.dataset.feederResolved = "false";
        return;
    }

    if (nameElement instanceof HTMLAnchorElement) {
        const span = document.createElement("span");
        span.className = "team-name";
        span.textContent = label;
        nameElement.replaceWith(span);
    } else if (nameElement) {
        nameElement.textContent = label;
    }
    teamElement.dataset.feederResolved = "true";
}

function isKnockoutFeederView() {
    return Boolean(
        document.querySelector(".world-cup-bracket-panel")
        || document.querySelector(".world-cup-knockout-round-layout")
        || document.querySelector(".world-cup-overview-knockout-block")
    );
}

function applyWorldCupKnockoutFeederWinners() {
    if (!isKnockoutFeederView()) {
        return;
    }

    seedWorldCupKnockoutMatchCacheFromDom();
    const matches = Array.from(worldCupKnockoutMatchCache.values());
    if (matches.length === 0) {
        return;
    }

    const edition = String(
        document.querySelector(".football-content-pad")?.dataset.worldCupEdition ?? ""
    ).trim();

    document.querySelectorAll(".world-cup-score-widget[id]").forEach((widget) => {
        const cached = worldCupKnockoutMatchCache.get(widget.id);
        if (!cached) {
            return;
        }

        const sides = [
            ["home", cached.home_team],
            ["away", cached.away_team],
        ];

        for (const [side, apiTeam] of sides) {
            let displayTeam = apiTeam;

            if (!isConfirmedKnockoutTeam(apiTeam)) {
                const resolved = resolveFeederTeam(apiTeam, matches);
                if (resolved) {
                    displayTeam = resolved;
                }
            }

            if (!isConfirmedKnockoutTeam(displayTeam)) {
                continue;
            }

            const teamElement = widget.querySelectorAll(":scope > .team")[side === "home" ? 0 : 1];
            const currentLabel = teamElement?.querySelector(".team-name")?.textContent?.trim() ?? "";
            const nextLabel = teamDisplayLabel(displayTeam);
            const apiLabel = teamDisplayLabel(apiTeam);
            const apiConfirmed = isConfirmedKnockoutTeam(apiTeam);

            if (apiConfirmed) {
                if (currentLabel !== apiLabel) {
                    updateKnockoutTeamSlot(widget, side, apiTeam, edition);
                }
                continue;
            }

            if (currentLabel !== nextLabel) {
                updateKnockoutTeamSlot(widget, side, displayTeam, edition);
            }
        }
    });
}

function worldCupKnockoutNeedsFullMatchWindow() {
    return isKnockoutFeederView();
}

window.mergeWorldCupKnockoutMatches = mergeWorldCupKnockoutMatches;
window.applyWorldCupKnockoutFeederWinners = applyWorldCupKnockoutFeederWinners;
window.worldCupKnockoutNeedsFullMatchWindow = worldCupKnockoutNeedsFullMatchWindow;

document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    if (!isKnockoutFeederView()) {
        return;
    }

    seedWorldCupKnockoutMatchCacheFromDom();
    applyWorldCupKnockoutFeederWinners();
});
