(function () {
    "use strict";

    const dataNode = document.getElementById("feeds-sidebar-feed-groups");
    if (!(dataNode instanceof HTMLScriptElement)) {
        return;
    }

    /** @type {{ all?: Array<Record<string, any>>, saved?: Array<Record<string, any>>, ["recently-read"]?: Array<Record<string, any>>, categories?: Record<string, Array<Record<string, any>>> }} */
    let sidebarGroups = {};
    try {
        const parsed = JSON.parse(dataNode.textContent || "{}");
        if (parsed && typeof parsed === "object") {
            sidebarGroups = parsed;
        }
    } catch (_error) {
        sidebarGroups = {};
    }

    const feedsRootPath = String(dataNode.dataset.feedsRootPath || "/feeds/").trim() || "/feeds/";
    const currentUrl = new URL(window.location.href);
    const currentCategory = String(currentUrl.searchParams.get("category") || "all").trim() || "all";
    const currentFeedId = String(currentUrl.searchParams.get("feed_id") || "").trim();
    const expandedStorageKey = "feeds-sidebar-expanded-category-v1";

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

    /** @type {Array<{ key: string, toggle: HTMLElement, panel: HTMLElement }>} */
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
        writeExpandedCategory(activeKey);

        disclosureRows.forEach(row => {
            const isActive = row.key === activeKey;
            row.toggle.classList.toggle("is-expanded", isActive);
            row.toggle.setAttribute("aria-expanded", isActive ? "true" : "false");
            row.panel.hidden = !isActive;
            row.panel.classList.toggle("is-expanded", isActive);
        });
    }

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

        if (feeds.length === 0) {
            return;
        }

        const toggleControl = document.createElement("span");
        toggleControl.className = "feed-sidebar-expand-toggle";
        toggleControl.setAttribute("role", "button");
        toggleControl.setAttribute("tabindex", "0");
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
            feedLink.dataset.feedId = feed.feed_id;
            feedLink.dataset.categoryKey = categoryKey;
            feedLink.href = buildReaderHref(categoryKey, feed.feed_id);
            feedLink.textContent = middleEllipsis(feed.title, maxFeedLabelChars());
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
                    window.location.assign(clearHref);
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
            event.preventDefault();
            event.stopPropagation();
            const shouldExpand = panel.hidden;
            if (shouldExpand) {
                setExpanded(categoryKey);
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
        });
    });

    const storedExpandedCategory = readExpandedCategory();

    if (currentFeedId !== "") {
        setExpanded(currentCategory);
    } else if (storedExpandedCategory !== "") {
        const hasStoredCategory = disclosureRows.some(row => row.key === storedExpandedCategory);
        if (hasStoredCategory) {
            setExpanded(storedExpandedCategory);
        }
    }
})();
