document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const jumpMenu = document.getElementById("football-jump-menu");
    const jumpLinks = document.querySelectorAll(".football-jump-link");

    for (const link of jumpLinks) {
        link.addEventListener("click", () => {
            if (jumpMenu && jumpMenu.hasAttribute("open")) {
                jumpMenu.removeAttribute("open");
            }
        });
    }

    centerNextMatchCard();
});

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
