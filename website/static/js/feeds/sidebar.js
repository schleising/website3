(function () {
    "use strict";

    const dataNode = document.getElementById("feeds-sidebar-feed-groups");
    if (!(dataNode instanceof HTMLScriptElement)) {
        return;
    }

    /** @type {{ all?: Array<Record<string, any>>, saved?: Array<Record<string, any>>, ["recently-read"]?: Array<Record<string, any>>, categories?: Record<string, Array<Record<string, any>>> }} */
    let sidebarGroups = {};
    let sidebarGroupsFingerprint = "";

    function serializeSidebarGroups(payload) {
        try {
            return JSON.stringify(payload);
        } catch (_error) {
            return "";
        }
    }

    try {
        const parsed = JSON.parse(dataNode.textContent || "{}");
        if (parsed && typeof parsed === "object") {
            sidebarGroups = parsed;
            sidebarGroupsFingerprint = serializeSidebarGroups(parsed);
        }
    } catch (_error) {
        sidebarGroups = {};
        sidebarGroupsFingerprint = "";
    }

    const feedsRootPath = String(dataNode.dataset.feedsRootPath || "/feeds/").trim() || "/feeds/";
    const currentUrl = new URL(window.location.href);
    const currentCategory = String(currentUrl.searchParams.get("category") || "all").trim() || "all";
    const currentFeedId = String(currentUrl.searchParams.get("feed_id") || "").trim();
    const expandedStorageKey = "feeds-sidebar-expanded-category-v1";
    const minimumShortLabelChars = 7;

    function middleEllipsis(label, maxChars) {
        const text = String(label || "").trim();
        if (text.length <= maxChars) {
            return text;
        }

        const leftChars = Math.ceil((maxChars - 1) / 2);
        const rightChars = Math.floor((maxChars - 1) / 2);
        return `${text.slice(0, leftChars)}…${text.slice(text.length - rightChars)}`;
    }

    function maxFeedLabelChars() {
        return window.matchMedia("(max-width: 52rem)").matches ? 22 : 30;
    }

    function fitFeedLabelToWidth(feedLink, fullLabel) {
        if (!(feedLink instanceof HTMLElement)) {
            return;
        }

        const labelNode = feedLink.querySelector(".feed-sidebar-feed-label");
        if (!(labelNode instanceof HTMLElement)) {
            return;
        }

        const normalizedFullLabel = String(fullLabel || "").trim();
        labelNode.textContent = normalizedFullLabel;
        if (normalizedFullLabel === "") {
            return;
        }

        // Reset to full label first; if it already fits we keep it unchanged.
        if (labelNode.scrollWidth <= labelNode.clientWidth + 1) {
            return;
        }

        let low = minimumShortLabelChars;
        let high = normalizedFullLabel.length;
        let bestFit = middleEllipsis(normalizedFullLabel, minimumShortLabelChars);

        while (low <= high) {
            const candidateChars = Math.floor((low + high) / 2);
            const candidateText = middleEllipsis(normalizedFullLabel, candidateChars);
            labelNode.textContent = candidateText;

            if (labelNode.scrollWidth <= labelNode.clientWidth + 1) {
                bestFit = candidateText;
                low = candidateChars + 1;
            } else {
                high = candidateChars - 1;
            }
        }

        labelNode.textContent = bestFit;
    }

    function applySidebarFeedLabelShortening(includeHidden = false) {
        const selector = includeHidden
            ? ".right-sidebar .feed-sidebar-feed-link"
            : ".right-sidebar .feed-sidebar-feed-panel:not([hidden]) .feed-sidebar-feed-link";
        const feedLinks = document.querySelectorAll(selector);
        feedLinks.forEach(link => {
            if (!(link instanceof HTMLElement)) {
                return;
            }

            const fullLabel = String(link.dataset.fullTitle || "").trim();
            fitFeedLabelToWidth(link, fullLabel);
        });
    }

    /** @type {Array<{ key: string, toggle: HTMLElement, panel: HTMLElement, enabled: boolean }>} */
    const disclosureRows = [];

    function readExpandedCategory() {
        try {
            return String(window.sessionStorage.getItem(expandedStorageKey) || "").trim();
        } catch (_error) {
            return "";
        }
    }

    function writeExpandedCategory(value) {
        try {
            if (value === "") {
                window.sessionStorage.removeItem(expandedStorageKey);
                return;
            }

            window.sessionStorage.setItem(expandedStorageKey, value);
        } catch (_error) {
            // Ignore storage failures.
        }
    }

    function buildReaderHref(categoryKey, feedId) {
        const url = new URL(feedsRootPath, window.location.origin);
        url.searchParams.set("category", categoryKey);
        if (feedId !== "") {
            url.searchParams.set("feed_id", feedId);
        }
        return `${url.pathname}${url.search}`;
    }

    function feedsForCategoryKey(categoryKey) {
        if (categoryKey === "all") {
            return Array.isArray(sidebarGroups.all) ? sidebarGroups.all : [];
        }
        if (categoryKey === "saved") {
            return Array.isArray(sidebarGroups.saved) ? sidebarGroups.saved : [];
        }
        if (categoryKey === "recently-read") {
            return Array.isArray(sidebarGroups["recently-read"])
                ? sidebarGroups["recently-read"]
                : [];
        }

        const grouped = sidebarGroups.categories;
        if (!grouped || typeof grouped !== "object") {
            return [];
        }

        const categoryFeeds = grouped[categoryKey];
        return Array.isArray(categoryFeeds) ? categoryFeeds : [];
    }

    function setExpanded(activeKey) {
        const activeRow = disclosureRows.find(row => row.key === activeKey);
        const resolvedActiveKey = (activeRow && activeRow.enabled) ? activeKey : "";
        writeExpandedCategory(resolvedActiveKey);

        disclosureRows.forEach(row => {
            const isActive = row.enabled && row.key === resolvedActiveKey;
            row.toggle.classList.toggle("is-expanded", isActive);
            row.toggle.setAttribute("aria-expanded", isActive ? "true" : "false");
            row.panel.hidden = !isActive;
            row.panel.classList.toggle("is-expanded", isActive);
        });
    }

    function readExpandedCategoryFromRows() {
        const expandedRow = disclosureRows.find(
            row => row.toggle.classList.contains("is-expanded") && row.panel.hidden === false
        );

        return expandedRow ? expandedRow.key : "";
    }

    function clearSidebarPanels() {
        const existingPanels = document.querySelectorAll(".right-sidebar .feed-sidebar-feed-panel");
        existingPanels.forEach(panel => {
            panel.remove();
        });

        const existingToggles = document.querySelectorAll(".right-sidebar .feed-sidebar-expand-toggle");
        existingToggles.forEach(toggle => {
            toggle.remove();
        });

        const expandableCategoryLinks = document.querySelectorAll(
            ".right-sidebar a.feed-category-link.feed-category-link-expandable"
        );
        expandableCategoryLinks.forEach(link => {
            link.classList.remove("feed-category-link-expandable");
        });

        disclosureRows.length = 0;
    }

    function renderSidebarPanels(options = {}) {
        const preserveExpanded = options.preserveExpanded !== false;
        const preferredExpandedCategory = preserveExpanded
            ? (readExpandedCategoryFromRows() || readExpandedCategory())
            : readExpandedCategory();

        clearSidebarPanels();

        /** @type {NodeListOf<HTMLAnchorElement>} */
        const categoryLinks = document.querySelectorAll(
            ".right-sidebar a.feed-category-link[data-category-shortcut], .right-sidebar a.feed-category-link[data-category-id]"
        );

        categoryLinks.forEach(link => {
            const shortcut = String(link.dataset.categoryShortcut || "").trim();
            const categoryId = String(link.dataset.categoryId || "").trim();
            const categoryKey = shortcut || categoryId;
            if (categoryKey === "") {
                return;
            }

            const feeds = feedsForCategoryKey(categoryKey)
                .map(feed => ({
                    feed_id: String(feed.feed_id || "").trim(),
                    title: String(feed.title || "").trim(),
                }))
                .filter(feed => feed.feed_id !== "" && feed.title !== "");
            const hasFeeds = feeds.length > 0;

            const toggleControl = document.createElement("span");
            toggleControl.className = "feed-sidebar-expand-toggle";
            if (!hasFeeds) {
                toggleControl.classList.add("is-disabled");
            }
            toggleControl.setAttribute("role", "button");
            toggleControl.setAttribute("tabindex", hasFeeds ? "0" : "-1");
            toggleControl.setAttribute("aria-disabled", hasFeeds ? "false" : "true");
            toggleControl.setAttribute("aria-expanded", "false");
            toggleControl.setAttribute("aria-label", `Show feeds in ${categoryKey}`);
            toggleControl.innerHTML = "<span aria-hidden=\"true\">▼</span>";

            link.classList.add("feed-category-link-expandable");
            link.appendChild(toggleControl);

            const panel = document.createElement("div");
            panel.className = "feed-sidebar-feed-panel";
            panel.hidden = true;

            const list = document.createElement("div");
            list.className = "feed-sidebar-feed-list";

            feeds.forEach(feed => {
                const feedLink = document.createElement("a");
                feedLink.className = "feed-sidebar-link feed-sidebar-feed-link";
                feedLink.dataset.historyMode = "feeds-category";
                feedLink.dataset.feedId = feed.feed_id;
                feedLink.dataset.categoryKey = categoryKey;
                feedLink.href = buildReaderHref(categoryKey, feed.feed_id);
                feedLink.dataset.fullTitle = feed.title;
                const feedLabel = document.createElement("span");
                feedLabel.className = "feed-sidebar-feed-label";
                feedLabel.textContent = middleEllipsis(feed.title, maxFeedLabelChars());
                feedLink.appendChild(feedLabel);
                feedLink.title = feed.title;

                const clearHref = buildReaderHref(categoryKey, "");
                feedLink.dataset.clearHref = clearHref;

                if (currentCategory === categoryKey && currentFeedId !== "" && currentFeedId === feed.feed_id) {
                    feedLink.classList.add("is-current");
                    feedLink.setAttribute("aria-current", "page");
                }

                feedLink.addEventListener("click", event => {
                    if (currentCategory === categoryKey && currentFeedId !== "" && currentFeedId === feed.feed_id) {
                        event.preventDefault();
                        setExpanded(categoryKey);
                        window.location.replace(clearHref);
                    }
                });

                list.appendChild(feedLink);
            });

            panel.appendChild(list);

            const parent = link.parentElement;
            if (!(parent instanceof HTMLElement)) {
                return;
            }

            parent.insertBefore(panel, link.nextSibling);

            const onToggle = event => {
                if (!hasFeeds) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                const shouldExpand = panel.hidden;
                if (shouldExpand) {
                    setExpanded(categoryKey);
                    applySidebarFeedLabelShortening();
                    window.requestAnimationFrame(applySidebarFeedLabelShortening);
                } else {
                    setExpanded("");
                }
            };

            toggleControl.addEventListener("click", onToggle);
            toggleControl.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }

                onToggle(event);
            });

            disclosureRows.push({
                key: categoryKey,
                toggle: toggleControl,
                panel,
                enabled: hasFeeds,
            });
        });

        if (currentFeedId !== "") {
            setExpanded(currentCategory);
            applySidebarFeedLabelShortening();
            window.requestAnimationFrame(applySidebarFeedLabelShortening);
            return;
        }

        if (preferredExpandedCategory !== "") {
            const hasPreferredCategory = disclosureRows.some(
                row => row.key === preferredExpandedCategory
            );
            if (hasPreferredCategory) {
                setExpanded(preferredExpandedCategory);
                applySidebarFeedLabelShortening();
                window.requestAnimationFrame(applySidebarFeedLabelShortening);
                return;
            }
        }

        setExpanded("");
        window.requestAnimationFrame(applySidebarFeedLabelShortening);
    }

    function applySidebarGroupUpdate(nextGroups) {
        if (!nextGroups || typeof nextGroups !== "object") {
            return;
        }

        const nextFingerprint = serializeSidebarGroups(nextGroups);
        if (nextFingerprint !== "" && nextFingerprint === sidebarGroupsFingerprint) {
            return;
        }

        sidebarGroups = nextGroups;
        sidebarGroupsFingerprint = nextFingerprint;
        try {
            dataNode.textContent = JSON.stringify(nextGroups);
        } catch (_error) {
            // Ignore serialization issues for in-memory updates.
        }

        renderSidebarPanels({ preserveExpanded: true });
        requestSidebarWidthSync();
    }

    window.addEventListener("feeds:sidebar-groups-updated", event => {
        const detail = event && typeof event === "object" ? event.detail : null;
        if (!detail || typeof detail !== "object") {
            return;
        }

        const incomingGroups = detail.sidebarFeedGroups;
        if (!incomingGroups || typeof incomingGroups !== "object") {
            return;
        }

        applySidebarGroupUpdate(incomingGroups);
    });

    window.addEventListener("resize", () => {
        window.requestAnimationFrame(applySidebarFeedLabelShortening);
    }, { passive: true });

    function requestSidebarWidthSync() {
        if (typeof window.syncSidebarWidths === "function") {
            window.requestAnimationFrame(() => {
                window.syncSidebarWidths();
            });
        }
    }

    renderSidebarPanels({ preserveExpanded: true });
    requestSidebarWidthSync();
})();
