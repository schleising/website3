(function () {
    function syncBracketScroll(source, target) {
        if (target.scrollLeft !== source.scrollLeft) {
            target.scrollLeft = source.scrollLeft;
        }
    }

    function initBracketPanel(panel) {
        const headerScroll = panel.querySelector(".world-cup-bracket-header-scroll");
        const bodyScroll = panel.querySelector(".world-cup-bracket-scroll");
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
