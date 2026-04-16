document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const jumpMenu = document.getElementById("football-jump-menu");
    const toolbar = document.getElementById("football-all-matches-toolbar");
    const contentContainer = document.getElementById("content");
    const contentPad = document.querySelector(".football-content-pad");
    const jumpLinks = document.querySelectorAll(".football-jump-link");

    for (const link of jumpLinks) {
        link.addEventListener("click", (clickEvent) => {
            const shouldCenterNextMatch = link.dataset.centerNextMatch === "true";

            if (shouldCenterNextMatch) {
                clickEvent.preventDefault();
                centerNextMatchCard();
            }

            if (jumpMenu && jumpMenu.hasAttribute("open")) {
                jumpMenu.removeAttribute("open");
            }
        });
    }

    document.addEventListener("click", (clickEvent) => {
        if (!jumpMenu || !jumpMenu.hasAttribute("open")) {
            return;
        }

        const target = clickEvent.target;
        if (target instanceof Node && !jumpMenu.contains(target)) {
            jumpMenu.removeAttribute("open");
        }
    });

    positionToolbar(toolbar, contentContainer, contentPad);
    window.addEventListener("resize", () => positionToolbar(toolbar, contentContainer, contentPad));
    window.addEventListener("scroll", () => positionToolbar(toolbar, contentContainer, contentPad), { passive: true });

    const shouldAutoCenter = toolbar?.dataset.autoCenterNextMatch === "true";

    if (shouldAutoCenter) {
        centerNextMatchCard();
    }
});

function positionToolbar(toolbar, contentContainer, contentPad) {
    if (!toolbar || !contentContainer) {
        return;
    }

    const contentRect = contentContainer.getBoundingClientRect();
    const fallbackPadPx = 14;
    let insetPadPx = fallbackPadPx;

    if (contentPad) {
        const padStyle = window.getComputedStyle(contentPad);
        const parsedPad = parseFloat(padStyle.paddingTop);
        if (!Number.isNaN(parsedPad) && parsedPad > 0) {
            insetPadPx = parsedPad;
        }
    }

    const firstDayHeading = document.querySelector(".football-day-heading");
    let dividerPillOffsetPx = 0;

    if (firstDayHeading) {
        const headingStyle = window.getComputedStyle(firstDayHeading);
        const parsedHeadingPadTop = parseFloat(headingStyle.paddingTop);
        if (!Number.isNaN(parsedHeadingPadTop) && parsedHeadingPadTop > 0) {
            dividerPillOffsetPx = parsedHeadingPadTop;
        }
    }

    toolbar.style.top = `${Math.round(contentRect.top + dividerPillOffsetPx)}px`;

    const rightOffset = Math.max(
        Math.round(window.innerWidth - contentRect.right + insetPadPx),
        8,
    );
    toolbar.style.right = `${rightOffset}px`;
}

function centerNextMatchCard() {
    const matchCards = Array.from(document.querySelectorAll(".score-widget[data-match-time]"));

    if (matchCards.length === 0) {
        return;
    }

    const now = new Date();
    let targetCard = null;

    for (const card of matchCards) {
        const matchTimeRaw = card.getAttribute("data-match-time");
        if (!matchTimeRaw) {
            continue;
        }

        const matchTime = new Date(matchTimeRaw);
        if (Number.isNaN(matchTime.getTime())) {
            continue;
        }

        if (matchTime >= now) {
            targetCard = card;
            break;
        }
    }

    if (!targetCard) {
        targetCard = matchCards[matchCards.length - 1];
    }

    requestAnimationFrame(() => {
        targetCard.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
        });
    });
}
