document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const jumpMenu = document.getElementById("world-cup-jump-menu");
    const jumpLinks = document.querySelectorAll(".football-jump-link");
    const contentPad = document.querySelector(".football-content-pad");

    jumpLinks.forEach((link) => {
        link.addEventListener("click", (clickEvent) => {
            clickEvent.preventDefault();
            smoothScrollToAnchor(link.getAttribute("href"));

            if (jumpMenu && jumpMenu.hasAttribute("open")) {
                jumpMenu.removeAttribute("open");
            }
        });
    });

    document.addEventListener("click", (clickEvent) => {
        if (!jumpMenu || !jumpMenu.hasAttribute("open")) {
            return;
        }

        const target = clickEvent.target;
        if (target instanceof Node && !jumpMenu.contains(target)) {
            jumpMenu.removeAttribute("open");
        }
    });

    if (contentPad?.dataset.autoCenterNextMatch === "true") {
        requestAnimationFrame(() => {
            centerNextUnfinishedMatch();
        });
    }
});

function centerNextUnfinishedMatch() {
    const matchEntries = collectMatchCardEntries();
    if (matchEntries.length === 0) {
        return;
    }

    const now = new Date();
    let targetCard = null;

    const liveEntries = matchEntries.filter(
        (entry) => entry.card.dataset.matchLive === "true"
    );
    if (liveEntries.length > 0) {
        targetCard = pickEarliestMatchEntry(liveEntries).card;
    }

    if (!targetCard) {
        const unfinishedUpcoming = matchEntries.filter(
            (entry) =>
                entry.card.dataset.matchFinished !== "true" &&
                entry.time.getTime() >= now.getTime()
        );
        if (unfinishedUpcoming.length > 0) {
            targetCard = pickEarliestMatchEntry(unfinishedUpcoming).card;
        }
    }

    if (!targetCard) {
        const unfinishedPast = matchEntries.filter(
            (entry) =>
                entry.card.dataset.matchFinished !== "true" &&
                entry.time.getTime() < now.getTime()
        );
        if (unfinishedPast.length > 0) {
            targetCard = pickLatestMatchEntry(unfinishedPast).card;
        }
    }

    if (!targetCard) {
        targetCard = pickLatestMatchEntry(matchEntries).card;
    }

    requestAnimationFrame(() => {
        scrollToMatchCard(targetCard);
    });
}

function scrollToMatchCard(card) {
    const scrollTarget = resolveOverviewScrollTarget(card);

    const bracketScroll = card.closest(".world-cup-bracket-scroll");
    if (bracketScroll instanceof HTMLElement) {
        scrollMatchCardInBracket(card, bracketScroll);
        return;
    }

    const contentContainer = document.getElementById("content");
    if (contentContainer instanceof HTMLElement && scrollTarget !== card) {
        requestAnimationFrame(() => {
            contentContainer.scrollTo({
                top: getCenteredScrollOffset(scrollTarget, contentContainer, "vertical"),
                behavior: "smooth",
            });
        });
        return;
    }

    scrollTarget.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
    });
}

const OVERVIEW_GROUP_BLOCK_SELECTOR = ".world-cup-overview-group-block";

function resolveOverviewScrollTarget(card) {
    const groupBlock = card.closest(OVERVIEW_GROUP_BLOCK_SELECTOR);
    return groupBlock instanceof HTMLElement ? groupBlock : card;
}

function scrollMatchCardInBracket(card, bracketScroll) {
    const contentContainer = document.getElementById("content");
    const panel = bracketScroll.closest(".world-cup-bracket-panel");
    const headerScroll = panel?.querySelector(".world-cup-bracket-header-scroll");

    requestAnimationFrame(() => {
        const horizontalTarget = getCenteredScrollOffset(
            card,
            bracketScroll,
            "horizontal"
        );
        bracketScroll.scrollTo({
            left: horizontalTarget,
            behavior: "smooth",
        });
        if (headerScroll instanceof HTMLElement) {
            headerScroll.scrollTo({
                left: horizontalTarget,
                behavior: "smooth",
            });
        }

        if (contentContainer instanceof HTMLElement) {
            contentContainer.scrollTo({
                top: getCenteredScrollOffset(card, contentContainer, "vertical"),
                behavior: "smooth",
            });
        } else {
            card.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "nearest",
            });
        }
    });
}

function getCenteredScrollOffset(element, container, axis) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    if (axis === "horizontal") {
        const elementCenter = elementRect.left + elementRect.width / 2;
        const containerCenter = containerRect.left + containerRect.width / 2;
        return container.scrollLeft + (elementCenter - containerCenter);
    }

    const elementCenter = elementRect.top + elementRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    return container.scrollTop + (elementCenter - containerCenter);
}

function collectMatchCardEntries() {
    const entries = [];

    for (const card of document.querySelectorAll(".score-widget[data-match-time]")) {
        const matchTimeRaw = card.getAttribute("data-match-time");
        if (!matchTimeRaw) {
            continue;
        }

        const time = new Date(matchTimeRaw);
        if (Number.isNaN(time.getTime())) {
            continue;
        }

        entries.push({ card, time });
    }

    return entries;
}

function pickEarliestMatchEntry(entries) {
    return entries.reduce((earliest, entry) =>
        entry.time.getTime() < earliest.time.getTime() ? entry : earliest
    );
}

function pickLatestMatchEntry(entries) {
    return entries.reduce((latest, entry) =>
        entry.time.getTime() > latest.time.getTime() ? entry : latest
    );
}

function smoothScrollToAnchor(anchorHref) {
    if (!anchorHref || !anchorHref.startsWith("#")) {
        return;
    }

    const target = document.querySelector(anchorHref);
    if (!target) {
        return;
    }

    requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}
