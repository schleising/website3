(function () {
    function syncBracketScroll(source, target) {
        if (target.scrollLeft !== source.scrollLeft) {
            target.scrollLeft = source.scrollLeft;
        }
    }

    function syncBracketColumnLayout(panel) {
        const headerMatrix = panel.querySelector(".world-cup-bracket-header-matrix");
        const bodyMatrix = panel.querySelector(".world-cup-bracket-matrix");
        if (headerMatrix === null || bodyMatrix === null) {
            return;
        }

        const panelStyle = getComputedStyle(panel);
        const roundWidth = panelStyle.getPropertyValue("--world-cup-bracket-round-width").trim();
        if (roundWidth === "") {
            return;
        }

        const roundCount = headerMatrix.querySelectorAll(".world-cup-bracket-round-label").length;
        const roundTracks = Array.from({ length: roundCount }, (_, index) => {
            const tracks = [roundWidth, "0px", "1.75rem"];
            if (index < roundCount - 1) {
                tracks.push("0px");
            }
            return tracks.join(" ");
        }).join(" ");
        const columns = roundTracks;

        headerMatrix.style.gridTemplateColumns = columns;
        bodyMatrix.style.gridTemplateColumns = columns;
        headerMatrix.style.width = `${bodyMatrix.scrollWidth}px`;
    }

    function initBracketPanel(panel) {
        const headerScroll = panel.querySelector(".world-cup-bracket-header-scroll");
        const bodyScroll = panel.querySelector(".world-cup-bracket-scroll");
        const bodyMatrix = panel.querySelector(".world-cup-bracket-matrix");
        if (headerScroll === null || bodyScroll === null) {
            return;
        }

        let syncing = false;

        const linkScroll = (source, target) => {
            if (syncing) {
                return;
            }
            syncing = true;
            syncBracketScroll(source, target);
            syncing = false;
        };

        const refreshColumnLayout = () => {
            syncBracketColumnLayout(panel);
            linkScroll(bodyScroll, headerScroll);
        };

        headerScroll.addEventListener(
            "scroll",
            () => linkScroll(headerScroll, bodyScroll),
            { passive: true }
        );
        bodyScroll.addEventListener(
            "scroll",
            () => linkScroll(bodyScroll, headerScroll),
            { passive: true }
        );

        refreshColumnLayout();

        if (bodyMatrix !== null && typeof ResizeObserver !== "undefined") {
            const resizeObserver = new ResizeObserver(() => {
                refreshColumnLayout();
            });
            resizeObserver.observe(bodyMatrix);
        } else {
            window.addEventListener("resize", refreshColumnLayout, { passive: true });
        }

        if (document.fonts !== undefined && typeof document.fonts.ready?.then === "function") {
            document.fonts.ready.then(refreshColumnLayout).catch(() => {});
        }
    }

    function initWorldCupBrackets() {
        document
            .querySelectorAll(".world-cup-bracket-panel")
            .forEach((panel) => initBracketPanel(panel));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initWorldCupBrackets);
    } else {
        initWorldCupBrackets();
    }
})();
