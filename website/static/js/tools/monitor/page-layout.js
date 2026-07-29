(function initMonitorPageLayout() {
    var chrome = document.querySelector(".page-chrome");
    if (chrome == null) {
        return;
    }

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

    window.addEventListener("resize", syncChromeHeight);
    window.addEventListener("orientationchange", syncChromeHeight);
    syncChromeHeight();
})();
