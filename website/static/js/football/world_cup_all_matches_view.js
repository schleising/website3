document.addEventListener("readystatechange", (event) => {
    if (event.target.readyState !== "complete") {
        return;
    }

    const jumpMenu = document.getElementById("world-cup-jump-menu");
    const jumpLinks = document.querySelectorAll(".football-jump-link");

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
});

function smoothScrollToAnchor(anchorHref) {
    if (!anchorHref || !anchorHref.startsWith("#")) {
        return;
    }

    const target = document.querySelector(anchorHref);
    if (!target) {
        return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
}
