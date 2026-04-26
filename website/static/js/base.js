// Add a callback for state changes
let sharedSidebarWidthPx = 0;

document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        window.onresize = function() {
            closeMobileSidebarsOnDesktop();
            syncSidebarWidths();
        };

        highlightCurrentSidebarLinks();
        updateSidebarVisibility();
        setupMobileSidebarToggles();
        syncSidebarWidths();
        setupHistoryModeNavigation();
    }
});

function normaliseFeedsCategoryValue(value) {
    const trimmed = String(value || "").trim().toLowerCase();
    return trimmed === "" ? "all" : trimmed;
}

function isCustomFeedsCategory(value) {
    const category = normaliseFeedsCategoryValue(value);
    return category !== "all" && category !== "saved" && category !== "recently-read";
}

function handleFeedsCategoryNavigation(event, destinationUrl) {
    const currentUrl = new URL(window.location.href);
    const currentPath = normalisePath(currentUrl.pathname);
    const destinationPath = normalisePath(destinationUrl.pathname);
    const currentCategory = normaliseFeedsCategoryValue(currentUrl.searchParams.get("category"));
    const destinationCategory = normaliseFeedsCategoryValue(destinationUrl.searchParams.get("category"));
    const isSamePath = currentPath === destinationPath;

    if (destinationCategory === "all") {
        if (isSamePath && isCustomFeedsCategory(currentCategory) && window.history.length > 1) {
            event.preventDefault();
            window.history.back();
            return true;
        }

        event.preventDefault();
        window.location.replace(destinationUrl.toString());
        return true;
    }

    if (!isCustomFeedsCategory(destinationCategory)) {
        return false;
    }

    // Keep one-step back from a custom category to All Feeds.
    if (isSamePath && currentCategory === "all") {
        return false;
    }

    event.preventDefault();
    window.location.replace(destinationUrl.toString());
    return true;
}

function getNormalisedFootballBasePath() {
    const htmlElement = document.documentElement;
    const basePathValue = htmlElement?.dataset?.footballBasePath;
    const basePathRaw = String(basePathValue ?? "/football").trim();
    if (basePathRaw === "" || basePathRaw === "/") {
        return "/";
    }

    return normalisePath(basePathRaw);
}

function isFootballLatestPath(pathValue) {
    const footballBasePath = getNormalisedFootballBasePath();
    const normalisedPath = normalisePath(pathValue);
    return normalisedPath === footballBasePath;
}

function handleFootballShellNavigation(event, destinationUrl) {
    if (isFootballLatestPath(window.location.pathname)) {
        return false;
    }

    event.preventDefault();
    window.location.replace(destinationUrl.toString());
    return true;
}

function setupHistoryModeNavigation() {
    document.addEventListener("click", function(event) {
        if (event.defaultPrevented || event.button !== 0) {
            return;
        }

        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const link = target.closest('a[data-history-mode][href]');
        if (!(link instanceof HTMLAnchorElement)) {
            return;
        }

        const historyMode = String(link.dataset.historyMode || "").trim();
        if (historyMode === "") {
            return;
        }

        if (link.target && link.target !== "_self") {
            return;
        }

        if (link.hasAttribute("download")) {
            return;
        }

        const rawHref = String(link.getAttribute("href") || "").trim();
        if (rawHref === "" || rawHref.startsWith("#")) {
            return;
        }

        if (
            rawHref.startsWith("javascript:")
            || rawHref.startsWith("mailto:")
            || rawHref.startsWith("tel:")
        ) {
            return;
        }

        let destinationUrl;
        try {
            destinationUrl = new URL(rawHref, window.location.href);
        } catch {
            return;
        }

        if (destinationUrl.origin !== window.location.origin) {
            return;
        }

        if (historyMode === "feeds-category") {
            handleFeedsCategoryNavigation(event, destinationUrl);
            return;
        }

        if (historyMode === "football-shell") {
            handleFootballShellNavigation(event, destinationUrl);
            return;
        }

        if (historyMode !== "replace") {
            return;
        }

        event.preventDefault();
        window.location.replace(destinationUrl.toString());
    });

    document.addEventListener("submit", function(event) {
        if (event.defaultPrevented) {
            return;
        }

        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
            return;
        }

        const historyMode = String(form.dataset.historyMode || "").trim();
        if (historyMode !== "replace" && historyMode !== "football-shell") {
            return;
        }

        const method = String(form.method || "get").trim().toLowerCase();
        if (method !== "get") {
            return;
        }

        if (historyMode === "football-shell" && isFootballLatestPath(window.location.pathname)) {
            return;
        }

        if (form.target && form.target !== "" && form.target !== "_self") {
            return;
        }

        event.preventDefault();

        let actionUrl;
        try {
            actionUrl = new URL(form.getAttribute("action") || window.location.href, window.location.href);
        } catch {
            return;
        }

        if (actionUrl.origin !== window.location.origin) {
            form.submit();
            return;
        }

        actionUrl.search = "";

        const searchParams = new URLSearchParams();
        const formData = new FormData(form);
        for (const [key, value] of formData.entries()) {
            if (typeof value !== "string") {
                continue;
            }

            searchParams.append(key, value);
        }

        const queryString = searchParams.toString();
        if (queryString !== "") {
            actionUrl.search = `?${queryString}`;
        }

        window.location.replace(actionUrl.toString());
    });
}

function normalisePath(pathValue) {
    if (!pathValue) {
        return "/";
    }

    const trimmed = String(pathValue).trim();
    if (trimmed === "") {
        return "/";
    }

    if (trimmed === "/") {
        return "/";
    }

    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function highlightCurrentSidebarLinks() {
    const sidebarContainers = document.querySelectorAll(".left-sidebar .sub-level-nav-container, .right-sidebar .sub-level-nav-container");
    if (sidebarContainers.length === 0) {
        return;
    }

    const currentUrl = new URL(window.location.href);
    const currentPath = normalisePath(currentUrl.pathname);
    const currentSearch = currentUrl.searchParams.toString();

    for (const container of sidebarContainers) {
        const links = Array.from(container.querySelectorAll("a.sub-level-nav[href]"));
        if (links.length === 0) {
            continue;
        }

        let bestLink = null;
        let bestScore = -1;

        for (const link of links) {
            link.classList.remove("is-current");
            link.removeAttribute("aria-current");

            let parsedHref;
            try {
                parsedHref = new URL(link.getAttribute("href"), currentUrl);
            } catch {
                continue;
            }

            if (parsedHref.origin !== currentUrl.origin) {
                continue;
            }

            const linkPath = normalisePath(parsedHref.pathname);
            const linkSearch = parsedHref.searchParams.toString();
            const navPrefixAttr = link.getAttribute("data-nav-prefix");
            const navPrefixPath = navPrefixAttr ? normalisePath(navPrefixAttr) : null;
            const effectivePath = navPrefixPath || linkPath;

            let score = -1;
            if (effectivePath === currentPath) {
                score = 10000 + effectivePath.length;

                if (linkSearch === currentSearch) {
                    score += 10000;
                } else if (linkSearch === "") {
                    score += 1000;
                } else {
                    const isSubsetMatch = Array.from(parsedHref.searchParams.entries()).every(
                        ([key, value]) => currentUrl.searchParams.get(key) === value
                    );

                    if (isSubsetMatch) {
                        score += 5000 + parsedHref.searchParams.size;
                    }
                }
            } else if (effectivePath !== "/" && currentPath.startsWith(`${effectivePath}/`)) {
                score = 5000 + effectivePath.length;
            } else if (effectivePath === "/" && currentPath === "/") {
                score = 10000;
            }

            if (score > bestScore) {
                bestScore = score;
                bestLink = link;
            }
        }

        if (bestLink) {
            bestLink.classList.add("is-current");
            bestLink.setAttribute("aria-current", "page");
        }
    }
}

function updateSidebarVisibility() {
    const main = document.getElementById("main");
    const rightToggle = document.getElementById("right-nav-toggle");
    if (!main) {
        return;
    }

    const rightSidebar = main.querySelector(".right-sidebar");
    const rightSidebarContent = main.querySelector(".right-sidebar .sub-level-nav-container");
    if (!rightSidebar || !rightSidebarContent) {
        return;
    }

    const hasVisibleElements = rightSidebarContent.querySelector("a, button, input, select, textarea, img, svg, ul, ol, li, div, p, span, table, section, article") !== null;
    const hasTextContent = rightSidebarContent.textContent.trim().length > 0;
    const hasSidebarContent = hasVisibleElements || hasTextContent;

    rightSidebar.classList.toggle("hidden-sidebar", !hasSidebarContent);
    if (rightToggle) {
        rightToggle.classList.toggle("hidden-button", !hasSidebarContent);
    }

    syncSidebarWidths();
}

function setupMobileSidebarToggles() {
    const leftToggle = document.getElementById("left-nav-toggle");
    const rightToggle = document.getElementById("right-nav-toggle");
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");

    if (!leftToggle && !rightToggle && !leftSidebar && !rightSidebar) {
        return;
    }

    if (leftToggle && leftSidebar) {
        leftToggle.addEventListener("click", function() {
            toggleMobileSidebar(leftSidebar, leftToggle, rightSidebar, rightToggle);
        });
    }

    if (rightToggle && rightSidebar) {
        rightToggle.addEventListener("click", function() {
            toggleMobileSidebar(rightSidebar, rightToggle, leftSidebar, leftToggle);
        });
    }

    document.addEventListener("click", function(event) {
        if (!isOverlaySidebarMode()) {
            return;
        }

        const clickInsideControls = (leftToggle ? leftToggle.contains(event.target) : false)
            || (rightToggle ? rightToggle.contains(event.target) : false);
        const clickInsideLeft = leftSidebar ? leftSidebar.contains(event.target) : false;
        const clickInsideRight = rightSidebar ? rightSidebar.contains(event.target) : false;
        if (!clickInsideControls && !clickInsideLeft && !clickInsideRight) {
            closeMobileSidebars();
        }
    });
}

function toggleMobileSidebar(sidebarToToggle, toggleToToggle, sidebarToClose, toggleToClose) {
    if (!isOverlaySidebarMode()) {
        return;
    }

    const isOpening = !sidebarToToggle.classList.contains("mobile-open");
    if (isOpening) {
        positionMobileSidebar(sidebarToToggle, toggleToToggle);
    }
    sidebarToToggle.classList.toggle("mobile-open", isOpening);
    toggleToToggle.setAttribute("aria-expanded", isOpening ? "true" : "false");

    if (sidebarToClose && sidebarToClose.classList.contains("mobile-open")) {
        sidebarToClose.classList.remove("mobile-open");
        if (toggleToClose) {
            toggleToClose.setAttribute("aria-expanded", "false");
        }
    }

    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");
    const anySidebarOpen = (leftSidebar ? leftSidebar.classList.contains("mobile-open") : false)
        || (rightSidebar ? rightSidebar.classList.contains("mobile-open") : false);

    document.body.classList.toggle("nav-drawer-open", anySidebarOpen);
}

function closeMobileSidebars() {
    const leftToggle = document.getElementById("left-nav-toggle");
    const rightToggle = document.getElementById("right-nav-toggle");
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");

    if (leftSidebar) {
        leftSidebar.classList.remove("mobile-open");
        leftSidebar.style.top = "";
        leftSidebar.style.left = "";
        leftSidebar.style.right = "";
    }

    if (rightSidebar) {
        rightSidebar.classList.remove("mobile-open");
        rightSidebar.style.top = "";
        rightSidebar.style.left = "";
        rightSidebar.style.right = "";
    }

    if (leftToggle) {
        leftToggle.setAttribute("aria-expanded", "false");
    }
    if (rightToggle) {
        rightToggle.setAttribute("aria-expanded", "false");
    }

    document.body.classList.remove("nav-drawer-open");
}

function positionMobileSidebar(sidebar, toggleButton) {
    const buttonRect = toggleButton.getBoundingClientRect();
    const isRightMenu = sidebar.classList.contains("right-sidebar");
    const viewportPadding = 8;

    sidebar.style.top = Math.round(buttonRect.bottom + 6) + "px";
    if (isRightMenu) {
        sidebar.style.right = Math.max(viewportPadding, Math.round(window.innerWidth - buttonRect.right)) + "px";
        sidebar.style.left = "auto";
    } else {
        sidebar.style.left = Math.max(viewportPadding, Math.round(buttonRect.left)) + "px";
        sidebar.style.right = "auto";
    }
}

function closeMobileSidebarsOnDesktop() {
    if (!isOverlaySidebarMode()) {
        closeMobileSidebars();
    }
}

function syncSidebarWidths() {
    const leftSidebar = document.getElementById("left-sidebar-menu");
    const rightSidebar = document.getElementById("right-sidebar-menu");
    const hasLeftSidebar = !!leftSidebar;
    const hasRightSidebar = !!rightSidebar;

    if (!hasLeftSidebar && !hasRightSidebar) {
        return;
    }

    const overlayMode = isOverlaySidebarMode();
    if (overlayMode) {
        // Clear previously applied widths so measurement can shrink when content changes.
        if (leftSidebar) {
            leftSidebar.style.width = "";
        }
        if (rightSidebar) {
            rightSidebar.style.width = "";
        }
    }

    const leftWidth = leftSidebar ? measureSidebarContentWidth(leftSidebar) : 0;
    const rightAvailable = rightSidebar ? !rightSidebar.classList.contains("hidden-sidebar") : false;
    const rightWidth = rightSidebar && rightAvailable ? measureSidebarContentWidth(rightSidebar) : 0;

    const widthCandidates = [];
    if (hasLeftSidebar) {
        widthCandidates.push(leftWidth);
    }
    if (rightAvailable) {
        widthCandidates.push(rightWidth);
    }
    const contentWidth = widthCandidates.length > 0 ? Math.max(...widthCandidates) : 0;

    if (!overlayMode && contentWidth > 0) {
        // Keep desktop width in sync with current content instead of max-ever history.
        sharedSidebarWidthPx = contentWidth;
    }

    if (overlayMode) {
        const overlayMaxWidth = getOverlaySidebarMaxWidth();
        if (leftSidebar && leftWidth > 0) {
            leftSidebar.style.width = Math.min(leftWidth, overlayMaxWidth) + "px";
        }
        if (rightSidebar && rightAvailable && rightWidth > 0) {
            rightSidebar.style.width = Math.min(rightWidth, overlayMaxWidth) + "px";
        }
    } else if (sharedSidebarWidthPx > 0) {
        if (leftSidebar) {
            leftSidebar.style.width = sharedSidebarWidthPx + "px";
        }
        if (rightSidebar && rightAvailable) {
            rightSidebar.style.width = sharedSidebarWidthPx + "px";
        }
    }

    const collapseProbeWidth = overlayMode ? contentWidth : Math.max(contentWidth, sharedSidebarWidthPx);
    const visibleSidebarCount = (hasLeftSidebar ? 1 : 0) + (rightAvailable ? 1 : 0);
    updateSidebarCollapseMode(collapseProbeWidth, visibleSidebarCount);
}

function getOverlaySidebarMaxWidth() {
    const viewportLimit = Math.max(160, Math.floor(window.innerWidth - 16));
    const content = document.getElementById("content");
    if (!content) {
        return viewportLimit;
    }

    const contentRect = content.getBoundingClientRect();
    if (!Number.isFinite(contentRect.width) || contentRect.width <= 0) {
        return viewportLimit;
    }

    return Math.max(160, Math.min(viewportLimit, Math.floor(contentRect.width)));
}

function measureSidebarContentWidth(sidebar) {
    const content = sidebar.querySelector(".sub-level-nav-container");
    if (!content) {
        return 0;
    }

    const styleSnapshot = {
        display: sidebar.style.display,
        visibility: sidebar.style.visibility,
        position: sidebar.style.position,
        left: sidebar.style.left,
        right: sidebar.style.right,
        width: sidebar.style.width
    };

    // Prevent stale inline widths from inflating measured scroll width.
    sidebar.style.width = "";

    const sidebarIsHidden = getComputedStyle(sidebar).display === "none";
    if (sidebarIsHidden) {
        sidebar.style.display = "flex";
        sidebar.style.visibility = "hidden";
        sidebar.style.position = "fixed";
        sidebar.style.left = "-9999px";
        sidebar.style.right = "auto";
    }

    const links = content.querySelectorAll(".sub-level-nav");
    let maxLinkWidth = 0;
    for (const link of links) {
        maxLinkWidth = Math.max(maxLinkWidth, measureIntrinsicLinkWidth(link));
    }

    const contentStyle = getComputedStyle(content);
    const sidebarStyle = getComputedStyle(sidebar);
    const contentPad = (parseFloat(contentStyle.paddingLeft) || 0) + (parseFloat(contentStyle.paddingRight) || 0);
    const sidebarPad = (parseFloat(sidebarStyle.paddingLeft) || 0) + (parseFloat(sidebarStyle.paddingRight) || 0);
    const sidebarBorder = (parseFloat(sidebarStyle.borderLeftWidth) || 0) + (parseFloat(sidebarStyle.borderRightWidth) || 0);
    const intrinsicWidth = Math.ceil(maxLinkWidth + contentPad + sidebarPad + sidebarBorder);
    const fallbackWidth = Math.ceil(content.scrollWidth);
    // If nav links exist, prefer intrinsic link measurement to avoid scrollWidth inflation
    // from hidden/fixed descendants during breakpoint transitions.
    const measuredWidth = links.length > 0
        ? intrinsicWidth
        : Math.max(fallbackWidth, intrinsicWidth);

    if (sidebarIsHidden) {
        sidebar.style.display = styleSnapshot.display;
        sidebar.style.visibility = styleSnapshot.visibility;
        sidebar.style.position = styleSnapshot.position;
        sidebar.style.left = styleSnapshot.left;
        sidebar.style.right = styleSnapshot.right;
    }

    sidebar.style.width = styleSnapshot.width;

    return measuredWidth;
}

function measureIntrinsicLinkWidth(link) {
    const linkStyle = getComputedStyle(link);
    const measureNode = document.createElement("span");
    measureNode.textContent = link.textContent;
    measureNode.style.position = "fixed";
    measureNode.style.left = "-9999px";
    measureNode.style.top = "-9999px";
    measureNode.style.visibility = "hidden";
    measureNode.style.whiteSpace = "nowrap";
    measureNode.style.fontFamily = linkStyle.fontFamily;
    measureNode.style.fontSize = linkStyle.fontSize;
    measureNode.style.fontWeight = linkStyle.fontWeight;
    measureNode.style.fontStyle = linkStyle.fontStyle;
    measureNode.style.letterSpacing = linkStyle.letterSpacing;
    measureNode.style.textTransform = linkStyle.textTransform;
    document.body.appendChild(measureNode);

    const textWidth = Math.ceil(measureNode.getBoundingClientRect().width);
    measureNode.remove();

    const horizontalPadding = parseFloat(linkStyle.paddingLeft) + parseFloat(linkStyle.paddingRight);
    const horizontalMargin = parseFloat(linkStyle.marginLeft) + parseFloat(linkStyle.marginRight);
    const horizontalBorder = parseFloat(linkStyle.borderLeftWidth) + parseFloat(linkStyle.borderRightWidth);

    return textWidth + horizontalPadding + horizontalMargin + horizontalBorder;
}

function updateSidebarCollapseMode(sidebarWidth, visibleSidebarCount) {
    const body = document.body;
    if (!body) {
        return;
    }

    if (visibleSidebarCount <= 0 || sidebarWidth <= 0) {
        body.classList.remove("collapsed-sidebars");
        return;
    }

    if (window.innerWidth <= 672) {
        body.classList.remove("collapsed-sidebars");
        return;
    }

    const outerPadding = 24;
    const mainGap = 16;
    const reservedForContent = 420;
    const requiredWidth = (sidebarWidth * visibleSidebarCount) + (mainGap * Math.max(0, visibleSidebarCount - 1)) + reservedForContent + outerPadding;
    const shouldCollapse = window.innerWidth < requiredWidth;

    body.classList.toggle("collapsed-sidebars", shouldCollapse);
}

function isOverlaySidebarMode() {
    return window.innerWidth <= 672 || document.body.classList.contains("collapsed-sidebars");
}

function checkForEnter(event, baseUrl, element, callback) {
    if (event.key == "Enter") {
        searchClicked(baseUrl, element, callback);
        return true;
    }
    return false;
};

function searchClicked(baseUrl, id, callback) {
    value = document.getElementById(id).value;

    if (value != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + value;
        xmlhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                var jsn = this.responseText;
                callback(jsn);
            }
        };
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    }
};

function blogLinkClicked(baseUrl, id, callback) {
    if (id != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + id;
        xmlhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                var jsn = this.responseText;
                callback(jsn);
            }
        };
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    }
};

function textareaAcceptTab(id) {
    document.getElementById(id).addEventListener('keydown', function(event) {
        if (event.key == 'Tab') {
          event.preventDefault();
          var start = this.selectionStart;
          var end = this.selectionEnd;

          // set textarea value to: text before caret + tab + text after caret
          this.value = this.value.substring(0, start) +
            "\t" + this.value.substring(end);

          // put caret at right position again
          this.selectionStart =
            this.selectionEnd = start + 1;
        }
    });
};

function textareaOverridePaste(id, callback) {
    document.getElementById(id).addEventListener('paste', function(event){
        event.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;

        // set textarea value to: text before caret + tab + text after caret
        this.value = this.value.substring(0, start) +
        event.clipboardData.getData("text") + this.value.substring(end);

        // put caret at right position again
        this.selectionStart =
        this.selectionEnd = start + event.clipboardData.getData("text").length

        callback(event)
    });
};

function storageAvailable(type) {
    let storage;
    try {
        storage = window[type];
        const x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            (storage && storage.length !== 0);
    }
}
