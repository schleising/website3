(function initConverterPageLayout() {
    var chrome = document.querySelector(".page-chrome");
    if (chrome == null) {
        return;
    }

    var liveStage = chrome.querySelector(".live-stage");
    var root = document.documentElement;

    function syncChromeHeight() {
        var isFixed = window.getComputedStyle(chrome).position === "fixed";
        if (!isFixed) {
            root.style.setProperty("--page-chrome-height", "0px");
            return;
        }
        var height = Math.ceil(chrome.getBoundingClientRect().height);
        root.style.setProperty("--page-chrome-height", height + "px");
    }

    if (typeof ResizeObserver === "function") {
        var observer = new ResizeObserver(syncChromeHeight);
        observer.observe(chrome);
    }

    if (liveStage != null && typeof MutationObserver === "function") {
        var mutationObserver = new MutationObserver(syncChromeHeight);
        mutationObserver.observe(liveStage, {
            attributes: true,
            attributeFilter: ["hidden", "style", "class"]
        });
    }

    window.addEventListener("resize", syncChromeHeight);
    window.addEventListener("orientationchange", syncChromeHeight);
    syncChromeHeight();
})();
