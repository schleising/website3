/**
 * Feed admin page live refresh controller.
 */
(function () {
    "use strict";

    /** @type {HTMLElement | null} */
    const root = document.getElementById("feeds-admin-root");
    if (!root) {
        return;
    }

    /** @type {string} */
    const categoriesEndpoint = root.dataset.categoriesEndpoint || "/feeds/api/categories/";
    /** @type {string} */
    const adminFeedsEndpoint = root.dataset.adminFeedsEndpoint || "/feeds/api/admin/feeds/";

    /** @type {HTMLElement | null} */
    const adminTableBody = document.getElementById("feed-admin-table-body");
    /** @type {HTMLElement | null} */
    const adminEmptyNode = document.getElementById("feed-admin-empty");
    /** @type {HTMLElement | null} */
    const adminTableWrap = document.getElementById("feed-admin-table-wrap");

    /** @type {Intl.DateTimeFormat} */
    const localeDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });

    /** @type {boolean} */
    let liveRefreshInFlight = false;

    /**
     * Format an ISO datetime string to browser locale text.
     *
     * @param {string} value
     * @returns {string}
     */
    function formatLocaleDateTime(value) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (normalized === "") {
            return "-";
        }

        const dateValue = new Date(normalized);
        if (Number.isNaN(dateValue.getTime())) {
            return "-";
        }

        return localeDateTimeFormatter.format(dateValue);
    }

    /**
     * Update sidebar counts and category badges.
     *
     * @param {{ all_unread_count?: number, saved_count?: number, categories?: Array<{ category_id?: string, unread_count?: number, muted?: boolean, color_hex?: string }> }} payload
     */
    function updateSidebarCounts(payload) {
        const allLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="all"]');
        const savedLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="saved"]');

        if (allLink) {
            const allCountNode = allLink.querySelector(".feed-category-count");
            if (allCountNode) {
                allCountNode.textContent = String(Number(payload.all_unread_count || 0));
            }
        }

        if (savedLink) {
            const savedCountNode = savedLink.querySelector(".feed-category-count");
            if (savedCountNode) {
                savedCountNode.textContent = String(Number(payload.saved_count || 0));
            }
        }

        const categories = Array.isArray(payload.categories) ? payload.categories : [];
        categories.forEach(category => {
            const categoryId = String(category.category_id || "").trim();
            if (categoryId === "") {
                return;
            }

            const link = document.querySelector(`.feed-category-link[data-category-id="${CSS.escape(categoryId)}"]`);
            if (!(link instanceof HTMLElement)) {
                return;
            }

            const countNode = link.querySelector(".feed-category-count");
            if (countNode instanceof HTMLElement) {
                countNode.textContent = String(Number(category.unread_count || 0));
                countNode.style.setProperty("--feed-category-accent", String(category.color_hex || "#1F6FEB"));
            }

            link.classList.toggle("is-muted", Boolean(category.muted));
        });
    }

    /**
     * Fetch and apply right-sidebar updates.
     *
     * @returns {Promise<void>}
     */
    async function refreshSidebarCounts() {
        try {
            const response = await fetch(categoriesEndpoint, { method: "GET" });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            updateSidebarCounts(payload);
        } catch (_error) {
            // Preserve existing sidebar state when refresh fails.
        }
    }

    /**
     * Build a feed admin data cell.
     *
     * @param {string} text
     * @param {string} [extraClassName]
     * @returns {HTMLDivElement}
     */
    function createTextCell(text, extraClassName = "") {
        const cell = document.createElement("div");
        cell.className = `feed-admin-cell ${extraClassName}`.trim();
        cell.setAttribute("role", "cell");
        cell.textContent = text;
        return cell;
    }

    /**
     * Build a localized time cell.
     *
     * @param {string} isoValue
     * @returns {HTMLDivElement}
     */
    function createTimeCell(isoValue) {
        const normalizedIso = typeof isoValue === "string" ? isoValue.trim() : "";
        const cell = document.createElement("div");
        cell.className = "feed-admin-cell";
        cell.setAttribute("role", "cell");

        const timeNode = document.createElement("time");
        timeNode.className = "feed-admin-time";
        timeNode.dataset.feedTimeValue = normalizedIso;
        if (normalizedIso !== "") {
            timeNode.dateTime = normalizedIso;
        }
        timeNode.textContent = formatLocaleDateTime(normalizedIso);

        cell.appendChild(timeNode);
        return cell;
    }

    /**
     * Render live admin table rows.
     *
     * @param {Array<{ feed_id?: string, feed_name?: string, article_count?: number, last_refresh_at_iso?: string, next_refresh_at_iso?: string, last_refresh_status?: string }>} rows
     */
    function renderAdminRows(rows) {
        if (!(adminTableBody instanceof HTMLElement)) {
            return;
        }

        const normalizedRows = Array.isArray(rows) ? rows : [];
        const hasRows = normalizedRows.length > 0;

        if (adminEmptyNode instanceof HTMLElement) {
            adminEmptyNode.hidden = hasRows;
        }

        if (adminTableWrap instanceof HTMLElement) {
            adminTableWrap.hidden = !hasRows;
        }

        adminTableBody.textContent = "";

        normalizedRows.forEach(row => {
            const feedId = String(row.feed_id || "").trim();
            const feedName = String(row.feed_name || "Feed").trim() || "Feed";
            const articleCount = Number(row.article_count || 0);
            const lastRefreshIso = String(row.last_refresh_at_iso || "").trim();
            const nextRefreshIso = String(row.next_refresh_at_iso || "").trim();
            const lastRefreshStatus = String(row.last_refresh_status || "new").trim() || "new";

            const rowNode = document.createElement("div");
            rowNode.className = "feed-admin-table-row";
            rowNode.setAttribute("role", "row");
            if (feedId !== "") {
                rowNode.dataset.feedId = feedId;
            }

            const nameCell = createTextCell(feedName, "feed-admin-feed-name");
            nameCell.title = feedName;

            const countCell = createTextCell(String(Math.max(0, Number.isFinite(articleCount) ? articleCount : 0)));
            const statusCell = createTextCell(lastRefreshStatus, "feed-admin-status-cell");

            rowNode.appendChild(nameCell);
            rowNode.appendChild(countCell);
            rowNode.appendChild(createTimeCell(lastRefreshIso));
            rowNode.appendChild(createTimeCell(nextRefreshIso));
            rowNode.appendChild(statusCell);

            adminTableBody.appendChild(rowNode);
        });
    }

    /**
     * Localize SSR timestamps before the first live refresh cycle completes.
     */
    function localizeSsrTimes() {
        if (!(adminTableBody instanceof HTMLElement)) {
            return;
        }

        const timeNodes = adminTableBody.querySelectorAll(".feed-admin-time[data-feed-time-value]");
        timeNodes.forEach(timeNode => {
            if (!(timeNode instanceof HTMLTimeElement)) {
                return;
            }

            const isoValue = String(timeNode.dataset.feedTimeValue || "").trim();
            timeNode.textContent = formatLocaleDateTime(isoValue);
            if (isoValue !== "") {
                timeNode.dateTime = isoValue;
            } else {
                timeNode.removeAttribute("datetime");
            }
        });
    }

    /**
     * Fetch and apply live admin feed rows.
     *
     * @returns {Promise<void>}
     */
    async function refreshAdminRows() {
        try {
            const response = await fetch(adminFeedsEndpoint, { method: "GET" });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            const rows = Array.isArray(payload.feeds) ? payload.feeds : [];
            renderAdminRows(rows);
        } catch (_error) {
            // Keep existing admin table data when refresh fails.
        }
    }

    /**
     * Poll both sidebar and admin feed table for cross-device updates.
     *
     * @returns {Promise<void>}
     */
    async function refreshLiveAdminState() {
        if (liveRefreshInFlight) {
            return;
        }

        liveRefreshInFlight = true;

        try {
            await Promise.all([
                refreshSidebarCounts(),
                refreshAdminRows(),
            ]);
        } finally {
            liveRefreshInFlight = false;
        }
    }

    localizeSsrTimes();
    refreshLiveAdminState();
    window.setInterval(refreshLiveAdminState, 2000);
})();
