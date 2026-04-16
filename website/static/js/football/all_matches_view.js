document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const jumpMenu = document.getElementById("football-jump-menu");
    const toolbar = document.getElementById("football-all-matches-toolbar");
    const dayList = document.querySelector(".football-day-list");
    const jumpLinks = document.querySelectorAll(".football-jump-link");

    for (const link of jumpLinks) {
        link.addEventListener("click", () => {
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

    positionToolbar(toolbar, dayList);
    window.addEventListener("resize", () => positionToolbar(toolbar, dayList));
    window.addEventListener("scroll", () => positionToolbar(toolbar, dayList), { passive: true });

    const shouldAutoCenter = toolbar?.dataset.autoCenterNextMatch === "true";

    if (shouldAutoCenter) {
        centerNextMatchCard();
    }
});

function positionToolbar(toolbar, dayList) {
    if (!toolbar || !dayList) {
        return;
    }

    const listRect = dayList.getBoundingClientRect();
    const listRightSpacing = Math.max(window.innerWidth - listRect.right + 10, 10);
    toolbar.style.right = `${Math.round(listRightSpacing)}px`;
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
