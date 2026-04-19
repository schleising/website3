/**
 * Feed reader keyboard and refresh controller.
 */
(function () {
    "use strict";

    /** @type {HTMLElement | null} */
    const root = document.getElementById("feeds-reader-root");
    if (!root) {
        return;
    }

    /** @type {HTMLElement | null} */
    const articleList = document.getElementById("feeds-article-list");
    if (!articleList) {
        return;
    }

    /** @type {HTMLElement} */
    const scrollContainer = /** @type {HTMLElement} */ (document.getElementById("content") || document.documentElement);
    /** @type {boolean} */
    const useElementScrollContainer = (
        scrollContainer instanceof HTMLElement
        && scrollContainer !== document.documentElement
        && scrollContainer !== document.body
    );

    /** @type {string} */
    const categoryFromUrl = new URLSearchParams(window.location.search).get("category");
    const selectedCategory = (categoryFromUrl && categoryFromUrl.trim() !== ""
        ? categoryFromUrl
        : (root.dataset.selectedCategory || "all"));
    /** @type {string} */
    const selectedStatus = root.dataset.selectedStatus || "unread";
    /** @type {string} */
    const articlesEndpoint = root.dataset.articlesEndpoint || "/feeds/api/articles/";
    /** @type {string} */
    const articleStatusesEndpoint = root.dataset.articleStatusesEndpoint || "/feeds/api/articles/statuses/";
    /** @type {string} */
    const categoriesEndpoint = root.dataset.categoriesEndpoint || "/feeds/api/categories/";
    /** @type {string} */
    const markReadEndpointTemplate = root.dataset.markReadEndpointTemplate || "";
    /** @type {string} */
    const markUnreadEndpointTemplate = root.dataset.markUnreadEndpointTemplate || "";
    /** @type {string} */
    const markSaveEndpointTemplate = root.dataset.markSaveEndpointTemplate || "";
    /** @type {string} */
    const markUnsaveEndpointTemplate = root.dataset.markUnsaveEndpointTemplate || "";
    /** @type {number} */
    const pageSize = Math.max(1, Number(root.dataset.pageSize || 10));
    /** @type {number} */
    let nextOffset = Math.max(0, Number(root.dataset.nextOffset || 0));
    /** @type {boolean} */
    let hasMorePages = String(root.dataset.hasMore || "false").toLowerCase() === "true";
    /** @type {number} */
    const prefetchRemainingThreshold = 3;
    /** @type {number} */
    const maxAutoPagesPerCycle = 3;
    /** @type {number} */
    const pageLoadRetryDelayMs = 900;
    /** @type {number} */
    const pagingWatchdogIntervalMs = 1200;
    /** @type {boolean} */
    let pageLoadInFlight = false;
    /** @type {boolean} */
    let pagePrefetchScheduled = false;
    /** @type {boolean} */
    let tailRefreshInFlight = false;
    /** @type {number} */
    let lastTailRefreshAtMs = 0;
    /** @type {number} */
    const tailRefreshMinIntervalMs = 1200;
    /** @type {boolean} */
    let headRefreshProbeInFlight = false;
    /** @type {number | null} */
    let pageLoadRetryTimerId = null;
    /** @type {number | null} */
    let pagingWatchdogTimerId = null;
    /** @type {IntersectionObserver | null} */
    let pagingSentinelObserver = null;
    /** @type {string} */
    const csrfToken = root.dataset.csrfToken || "";

    /** @type {string} */
    const knownArticleStorageKey = "feeds-reader-known-articles-v1";
    /** @type {string} */
    const newUnreadStorageKey = "feeds-reader-new-unread-v1";
    /** @type {number} */
    const maxStoredArticleIds = 2500;
    /** @type {string} */
    const emptyHintMessage = selectedCategory === "recently-read"
        ? "No recently read articles in the last 7 days."
        : (selectedCategory === "saved"
            ? "No saved articles yet."
            : "No unread articles in this view.");

    /** @type {number} */
    let selectedIndex = -1;

    /** @type {boolean} */
    // Server-driven list polling controls when read cards disappear.
    const retainSessionReadCards = false;

    /** @type {Set<string>} */
    const pendingReadIds = new Set();
    /** @type {Set<string>} */
    const pendingUnreadIds = new Set();
    /** @type {Set<string>} */
    const pendingSaveIds = new Set();
    /** @type {Set<string>} */
    const pendingUnsaveIds = new Set();
    /** @type {Set<string>} */
    const sessionUnsavedArticleIds = new Set();

    /** @type {boolean} */
    const isTouchOnlyDevice = (() => {
        const hasTouchCapability = typeof navigator.maxTouchPoints === "number"
            ? navigator.maxTouchPoints > 0
            : false;
        const coarsePointer = window.matchMedia("(any-pointer: coarse)").matches;
        const finePointer = window.matchMedia("(any-pointer: fine)").matches;
        return (hasTouchCapability || coarsePointer) && !finePointer;
    })();

    /** @type {boolean} */
    let touchScrollReadScheduled = false;

    /** @type {Intl.DateTimeFormat} */
    const articleTimeFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });

    /** @type {Set<string>} */
    const sessionReadArticleIds = new Set();

    /** @type {Set<string>} */
    const knownArticleIds = loadIdSet(knownArticleStorageKey);
    /** @type {Set<string>} */
    const newUnreadArticleIds = loadIdSet(newUnreadStorageKey);

    /** @type {boolean} */
    const hadKnownArticleHistory = knownArticleIds.size > 0;

    /**
     * Load a set of article IDs from localStorage.
     *
     * @param {string} storageKey
     * @returns {Set<string>}
     */
    function loadIdSet(storageKey) {
        try {
            const serialized = window.localStorage.getItem(storageKey);
            if (!serialized) {
                return new Set();
            }

            const parsed = JSON.parse(serialized);
            if (!Array.isArray(parsed)) {
                return new Set();
            }

            return new Set(
                parsed
                    .filter(value => typeof value === "string")
                    .map(value => value.trim())
                    .filter(value => value !== "")
            );
        } catch (_error) {
            return new Set();
        }
    }

    /**
     * Persist article ID sets with bounded size.
     *
     * @param {string} storageKey
     * @param {Set<string>} values
     */
    function saveIdSet(storageKey, values) {
        try {
            const list = Array.from(values);
            const bounded = list.length > maxStoredArticleIds
                ? list.slice(list.length - maxStoredArticleIds)
                : list;
            window.localStorage.setItem(storageKey, JSON.stringify(bounded));
        } catch (_error) {
            // Ignore storage quota and serialization issues.
        }
    }

    /**
     * Persist known/new article ID state.
     */
    function persistArticleIdState() {
        saveIdSet(knownArticleStorageKey, knownArticleIds);
        saveIdSet(newUnreadStorageKey, newUnreadArticleIds);
    }

    /**
     * Build URL for article list polling.
     *
     * @returns {string}
     */
    function buildArticlesUrl(offset = 0, limitOverride = pageSize, statusOverride = selectedStatus) {
        const params = new URLSearchParams();
        params.set("category", selectedCategory);
        params.set("status_filter", String(statusOverride || selectedStatus));
        params.set("offset", String(Math.max(0, Number(offset))));
        params.set("limit", String(Math.max(1, Number(limitOverride))));
        return `${articlesEndpoint}?${params.toString()}`;
    }

    /**
     * Return all article cards in current DOM order.
     *
     * @returns {HTMLElement[]}
     */
    function getCards() {
        return Array.from(articleList.querySelectorAll(".feed-article-card"));
    }

    /**
     * Render subtle empty-state hint text inside the article list container.
     */
    function renderInlineEmptyHint() {
        articleList.innerHTML = "";
        articleList.classList.add("is-empty");

        const hint = document.createElement("div");
        hint.className = "feeds-empty-state";
        hint.id = "feeds-empty-hint";
        hint.setAttribute("role", "status");
        hint.setAttribute("aria-live", "polite");
        hint.innerHTML = `
            <svg class="feeds-empty-state-icon" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
                <rect x="18" y="20" width="60" height="42" rx="8"></rect>
                <path d="M18 28l30 20 30-20"></path>
                <circle cx="71" cy="24" r="8"></circle>
            </svg>
            <p class="feeds-empty-state-text">${emptyHintMessage}</p>
        `;
        articleList.appendChild(hint);
        refreshPagingSentinelObserver();
    }

    /**
     * Clear selected styling from all cards and reset keyboard pointer.
     */
    function clearCardSelection() {
        selectedIndex = -1;
        getCards().forEach(card => card.classList.remove("is-selected"));
    }

    /**
     * Parse article datetimes and treat timezone-less values as UTC.
     *
     * @param {string} rawDatetime
     * @returns {Date | null}
     */
    function parseArticleDate(rawDatetime) {
        const trimmed = String(rawDatetime || "").trim();
        if (trimmed === "") {
            return null;
        }

        const hasTimezone = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(trimmed);
        const normalized = hasTimezone ? trimmed : `${trimmed}Z`;
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }

        return parsed;
    }

    /**
     * Return a sortable published timestamp for an article payload row.
     *
     * @param {Record<string, any> | undefined} article
     * @returns {number}
     */
    function getArticlePublishedTimestamp(article) {
        if (!article || !article.published_at) {
            return Number.POSITIVE_INFINITY;
        }

        const parsedDate = parseArticleDate(String(article.published_at || ""));
        if (!(parsedDate instanceof Date)) {
            return Number.POSITIVE_INFINITY;
        }

        return parsedDate.getTime();
    }

    /**
     * Return a sortable published timestamp for an existing card.
     *
     * @param {HTMLElement} card
     * @returns {number}
     */
    function getCardPublishedTimestamp(card) {
        const timeNode = card.querySelector("time[datetime]");
        if (!(timeNode instanceof HTMLTimeElement)) {
            return Number.POSITIVE_INFINITY;
        }

        const parsedDate = parseArticleDate(String(timeNode.dateTime || ""));
        if (!(parsedDate instanceof Date)) {
            return Number.POSITIVE_INFINITY;
        }

        return parsedDate.getTime();
    }

    /**
     * Reinsert a card by published timestamp so list order stays oldest-first.
     *
     * @param {HTMLElement} card
     */
    function repositionCardByPublishedDate(card) {
        const targetTimestamp = getCardPublishedTimestamp(card);
        const siblings = getCards().filter(entry => entry !== card);

        for (const sibling of siblings) {
            if (getCardPublishedTimestamp(sibling) > targetTimestamp) {
                articleList.insertBefore(card, sibling);
                return;
            }
        }

        articleList.appendChild(card);
    }

    /**
     * Convert datetime strings to current-client-locale text.
     *
     * @param {ParentNode} scope
     */
    function localizeTimeNodes(scope) {
        const timeNodes = scope.querySelectorAll("time[datetime]");
        timeNodes.forEach(timeNode => {
            if (!(timeNode instanceof HTMLTimeElement)) {
                return;
            }

            const rawDatetime = String(timeNode.dateTime || "").trim();
            if (rawDatetime === "") {
                return;
            }

            const parsedDate = parseArticleDate(rawDatetime);
            if (!(parsedDate instanceof Date)) {
                return;
            }

            timeNode.textContent = articleTimeFormatter.format(parsedDate);
        });
    }

    /**
     * Extract card article ID.
     *
     * @param {HTMLElement} card
     * @returns {string}
     */
    function getCardArticleId(card) {
        return String(card.dataset.articleId || "").trim();
    }

    /**
     * Return safe article link text, filtering null-like placeholders.
     *
     * @param {unknown} value
     * @returns {string}
     */
    function normalizeArticleLink(value) {
        if (typeof value !== "string") {
            return "";
        }

        const normalized = value.trim();
        if (normalized === "") {
            return "";
        }

        const lowered = normalized.toLowerCase();
        if (lowered === "none" || lowered === "null" || lowered === "undefined") {
            return "";
        }

        return normalized;
    }

    /**
     * Return whether a card is already marked read in current UI state.
     *
     * @param {HTMLElement} card
     * @returns {boolean}
     */
    function isCardMarkedRead(card) {
        return card.dataset.isRead === "true" || card.classList.contains("is-read-article");
    }

    /**
     * Return whether a card is currently marked saved in UI state.
     *
     * @param {HTMLElement} card
     * @returns {boolean}
     */
    function isCardSaved(card) {
        return card.dataset.isSaved === "true";
    }

    /**
     * Create the mark-as-unread icon button for a card.
     *
     * @returns {HTMLButtonElement}
     */
    function createUnreadButton() {
        const unreadButton = document.createElement("button");
        unreadButton.type = "button";
        unreadButton.className = "btn feed-article-unread-button";
        unreadButton.setAttribute("aria-label", "Mark article as unread");
        unreadButton.title = "Mark as unread";
        unreadButton.innerHTML = `
            <svg class="feed-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3.5 6.25h17v11.5h-17z"></path>
                <path d="M3.5 7l8.5 6 8.5-6"></path>
                <circle cx="18" cy="6" r="2.25"></circle>
            </svg>
        `;

        unreadButton.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            const card = unreadButton.closest(".feed-article-card");
            if (!(card instanceof HTMLElement)) {
                return;
            }

            await markCardUnread(card);
        });

        return unreadButton;
    }

    /**
     * Ensure mark-as-unread button visibility/state matches card read state.
     *
     * @param {HTMLElement} card
     */
    function syncCardUnreadAction(card) {
        const rightMeta = card.querySelector(".feed-article-meta-right");
        if (!(rightMeta instanceof HTMLElement)) {
            return;
        }

        const articleId = getCardArticleId(card);
        const isRead = isCardMarkedRead(card);
        let unreadButton = rightMeta.querySelector(".feed-article-unread-button");

        if (!isRead) {
            if (unreadButton instanceof HTMLButtonElement) {
                unreadButton.remove();
            }
            return;
        }

        if (!(unreadButton instanceof HTMLButtonElement)) {
            unreadButton = createUnreadButton();
            rightMeta.prepend(unreadButton);
        }

        unreadButton.disabled = pendingReadIds.has(articleId) || pendingUnreadIds.has(articleId);
    }

    /**
     * Create the save-for-later toggle button for a card.
     *
     * @returns {HTMLButtonElement}
     */
    function createSaveButton() {
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "btn feed-article-save-button";
        saveButton.setAttribute("aria-label", "Save article for later");
        saveButton.title = "Save for later";

        saveButton.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();

            const card = saveButton.closest(".feed-article-card");
            if (!(card instanceof HTMLElement)) {
                return;
            }

            if (isCardSaved(card)) {
                await markCardUnsaved(card);
            } else {
                await markCardSaved(card);
            }
        });

        return saveButton;
    }

    /**
     * Ensure save button exists and reflects saved state.
     *
     * @param {HTMLElement} card
     */
    function syncCardSaveAction(card) {
        const rightMeta = card.querySelector(".feed-article-meta-right");
        if (!(rightMeta instanceof HTMLElement)) {
            return;
        }

        const articleId = getCardArticleId(card);
        const isSaved = isCardSaved(card);
        let saveButton = rightMeta.querySelector(".feed-article-save-button");

        if (!(saveButton instanceof HTMLButtonElement)) {
            saveButton = createSaveButton();
            rightMeta.prepend(saveButton);
        }

        saveButton.classList.toggle("is-saved", isSaved);
        saveButton.setAttribute("aria-pressed", isSaved ? "true" : "false");
        saveButton.setAttribute("aria-label", isSaved ? "Remove from saved" : "Save article for later");
        saveButton.title = isSaved ? "Remove from saved" : "Save for later";
        saveButton.innerHTML = `
            <svg class="feed-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 3.75h10a1 1 0 0 1 1 1V21l-6-3.75L6 21V4.75a1 1 0 0 1 1-1z"></path>
            </svg>
        `;
        saveButton.disabled = pendingSaveIds.has(articleId) || pendingUnsaveIds.has(articleId);
    }

    /**
     * Apply read styling state for a card.
     *
     * @param {HTMLElement} card
     * @param {boolean} isRead
     */
    function setCardReadAppearance(card, isRead) {
        const wasRead = isCardMarkedRead(card);
        const hasUnreadButton = card.querySelector(".feed-article-unread-button") instanceof HTMLButtonElement;
        card.dataset.isRead = isRead ? "true" : "false";
        card.classList.toggle("is-read-article", isRead);

        // Avoid re-running unread action syncing when state is unchanged and UI already matches.
        const unreadActionAlreadyMatches = isRead ? hasUnreadButton : !hasUnreadButton;
        if (wasRead === isRead && unreadActionAlreadyMatches) {
            return;
        }

        syncCardUnreadAction(card);
    }

    /**
     * Apply saved styling state for a card.
     *
     * @param {HTMLElement} card
     * @param {boolean} isSaved
     */
    function setCardSavedAppearance(card, isSaved) {
        card.dataset.isSaved = isSaved ? "true" : "false";
        card.classList.toggle("is-saved-article", isSaved);
        syncCardSaveAction(card);
    }

    /**
     * Return currently-selected article ID if available.
     *
     * @returns {string}
     */
    function getSelectedArticleId() {
        const cards = getCards();
        if (selectedIndex < 0 || selectedIndex >= cards.length) {
            return "";
        }

        return getCardArticleId(cards[selectedIndex]);
    }

    /**
     * Update card "new" badge state.
     *
     * @param {HTMLElement} card
     * @param {boolean} showBadge
     */
    function setCardNewBadge(card, showBadge) {
        const existingBadge = card.querySelector(".feed-new-badge");

        if (!showBadge) {
            if (existingBadge) {
                existingBadge.remove();
            }
            card.classList.remove("is-new-article");
            return;
        }

        card.classList.add("is-new-article");

        if (existingBadge) {
            return;
        }

        const leftMeta = card.querySelector(".feed-article-meta-left");
        if (!(leftMeta instanceof HTMLElement)) {
            return;
        }

        const badge = document.createElement("span");
        badge.className = "feed-new-badge";
        badge.textContent = "New";
        leftMeta.appendChild(badge);
    }

    /**
     * Update card selected state and ensure focus visibility.
     *
     * @param {number} nextIndex
     */
    function setSelectedIndex(nextIndex, options = {}) {
        const markReadOnSelect = Boolean(options.markReadOnSelect);
        const shouldScrollIntoView = options.scrollIntoView !== false;
        const preferTopAlign = options.scrollMode === "top-if-needed";
        const forceTopAlign = options.scrollMode === "top-always";

        const cards = getCards();
        if (cards.length === 0) {
            selectedIndex = -1;
            return;
        }

        const boundedIndex = Math.max(0, Math.min(nextIndex, cards.length - 1));
        selectedIndex = boundedIndex;

        cards.forEach((card, index) => {
            card.classList.toggle("is-selected", index === boundedIndex);
        });

        cards[boundedIndex].focus({ preventScroll: true });
        if (shouldScrollIntoView) {
            const selectedCard = cards[boundedIndex];

            if (forceTopAlign) {
                selectedCard.scrollIntoView({ block: "start" });
            } else if (preferTopAlign) {
                const rect = selectedCard.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const needsTopAlignment = rect.top < 0 || rect.top > viewportHeight || rect.bottom > viewportHeight;

                if (needsTopAlignment) {
                    selectedCard.scrollIntoView({ block: "start" });
                }
            } else {
                selectedCard.scrollIntoView({ block: "nearest" });
            }
        }

        if (markReadOnSelect) {
            markCardRead(cards[boundedIndex]);
        }
    }

    /**
     * Build mark-read endpoint from a card article ID.
     *
     * @param {string} articleId
     * @returns {string}
     */
    function buildMarkReadUrl(articleId) {
        return markReadEndpointTemplate.replace("__ARTICLE_ID__", encodeURIComponent(articleId));
    }

    /**
     * Build mark-unread endpoint from a card article ID.
     *
     * @param {string} articleId
     * @returns {string}
     */
    function buildMarkUnreadUrl(articleId) {
        return markUnreadEndpointTemplate.replace("__ARTICLE_ID__", encodeURIComponent(articleId));
    }

    /**
     * Build save endpoint from a card article ID.
     *
     * @param {string} articleId
     * @returns {string}
     */
    function buildMarkSaveUrl(articleId) {
        return markSaveEndpointTemplate.replace("__ARTICLE_ID__", encodeURIComponent(articleId));
    }

    /**
     * Build unsave endpoint from a card article ID.
     *
     * @param {string} articleId
     * @returns {string}
     */
    function buildMarkUnsaveUrl(articleId) {
        return markUnsaveEndpointTemplate.replace("__ARTICLE_ID__", encodeURIComponent(articleId));
    }

    /**
     * Open a URL in a new tab using normal browser behavior.
     *
     * @param {string} link
     * @returns {void}
     */
    function openInNewTab(link) {
        const normalizedLink = normalizeArticleLink(link);
        if (normalizedLink === "") {
            return;
        }

        window.open(normalizedLink, "_blank", "noopener,noreferrer");
    }

    /**
     * Open a card link in a new tab and mark it read.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function openAndMarkCard(card) {
        const link = card.dataset.articleLink || "";
        openInNewTab(link);

        await markCardRead(card);
    }

    /**
    * Mark a card as read through the API and update card/sidebar state.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function markCardRead(card) {
        const articleId = card.dataset.articleId || "";
        if (articleId === "" || isCardMarkedRead(card)) {
            return;
        }

        if (pendingReadIds.has(articleId) || pendingUnreadIds.has(articleId)) {
            return;
        }

        pendingReadIds.add(articleId);
        syncCardUnreadAction(card);
        schedulePagePrefetchCheck();

        try {
            const response = await fetch(buildMarkReadUrl(articleId), {
                method: "POST",
                headers: {
                    "X-CSRF-Token": csrfToken,
                },
            });

            if (!response.ok) {
                return;
            }

            sessionReadArticleIds.add(articleId);
            newUnreadArticleIds.delete(articleId);
            persistArticleIdState();

            setCardReadAppearance(card, true);
            setCardNewBadge(card, false);
            await refreshSidebarCounts();
            schedulePagePrefetchCheck();
        } finally {
            pendingReadIds.delete(articleId);
            syncCardUnreadAction(card);
            schedulePagePrefetchCheck();
        }
    }

    /**
     * Mark a card as unread through the API and update card/sidebar state.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function markCardUnread(card) {
        const articleId = card.dataset.articleId || "";
        if (articleId === "" || !isCardMarkedRead(card)) {
            return;
        }

        if (pendingUnreadIds.has(articleId) || pendingReadIds.has(articleId)) {
            return;
        }

        pendingUnreadIds.add(articleId);
        syncCardUnreadAction(card);
        schedulePagePrefetchCheck();

        try {
            const response = await fetch(buildMarkUnreadUrl(articleId), {
                method: "POST",
                headers: {
                    "X-CSRF-Token": csrfToken,
                },
            });

            if (!response.ok) {
                return;
            }

            sessionReadArticleIds.delete(articleId);
            newUnreadArticleIds.delete(articleId);
            persistArticleIdState();

            if (selectedCategory === "recently-read") {
                const cards = getCards();
                const removedIndex = cards.indexOf(card);
                card.remove();

                await refreshSidebarCounts();

                const remainingCards = getCards();
                if (remainingCards.length === 0) {
                    renderInlineEmptyHint();
                    clearCardSelection();
                    return;
                }

                const nextIndex = Math.max(0, Math.min(removedIndex, remainingCards.length - 1));
                setSelectedIndex(nextIndex, { scrollIntoView: false });
                schedulePagePrefetchCheck();
                return;
            }

            setCardReadAppearance(card, false);
            setCardNewBadge(card, false);

            if (selectedStatus !== "read") {
                repositionCardByPublishedDate(card);
            }

            // Leave the card unselected after explicit mark-as-unread to avoid immediate reselection flows.
            if (selectedIndex >= 0) {
                const cards = getCards();
                if (cards[selectedIndex] === card) {
                    clearCardSelection();
                }
            }

            await refreshSidebarCounts();
            schedulePagePrefetchCheck();
        } finally {
            pendingUnreadIds.delete(articleId);
            if (document.contains(card)) {
                syncCardUnreadAction(card);
            }
            schedulePagePrefetchCheck();
        }
    }

    /**
     * Save a card for later through the API and update card/sidebar state.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function markCardSaved(card) {
        const articleId = card.dataset.articleId || "";
        if (articleId === "" || isCardSaved(card)) {
            return;
        }

        if (pendingSaveIds.has(articleId) || pendingUnsaveIds.has(articleId)) {
            return;
        }

        pendingSaveIds.add(articleId);
        syncCardSaveAction(card);
        schedulePagePrefetchCheck();

        try {
            const response = await fetch(buildMarkSaveUrl(articleId), {
                method: "POST",
                headers: {
                    "X-CSRF-Token": csrfToken,
                },
            });

            if (!response.ok) {
                return;
            }

            sessionUnsavedArticleIds.delete(articleId);
            setCardSavedAppearance(card, true);
            await refreshSidebarCounts();
            schedulePagePrefetchCheck();
        } finally {
            pendingSaveIds.delete(articleId);
            if (document.contains(card)) {
                syncCardSaveAction(card);
            }
            schedulePagePrefetchCheck();
        }
    }

    /**
     * Remove a card from saved list through the API and update card/sidebar state.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function markCardUnsaved(card) {
        const articleId = card.dataset.articleId || "";
        if (articleId === "" || !isCardSaved(card)) {
            return;
        }

        if (pendingUnsaveIds.has(articleId) || pendingSaveIds.has(articleId)) {
            return;
        }

        pendingUnsaveIds.add(articleId);
        syncCardSaveAction(card);
        schedulePagePrefetchCheck();

        try {
            const response = await fetch(buildMarkUnsaveUrl(articleId), {
                method: "POST",
                headers: {
                    "X-CSRF-Token": csrfToken,
                },
            });

            if (!response.ok) {
                return;
            }

            if (selectedCategory === "saved") {
                sessionUnsavedArticleIds.add(articleId);
            }

            setCardSavedAppearance(card, false);
            await refreshSidebarCounts();
            schedulePagePrefetchCheck();
        } finally {
            pendingUnsaveIds.delete(articleId);
            if (document.contains(card)) {
                syncCardSaveAction(card);
            }
            schedulePagePrefetchCheck();
        }
    }

    /**
     * Return whether touch-scroll read automation should run.
     *
     * @returns {boolean}
     */
    function shouldUseTouchScrollRead() {
        return isTouchOnlyDevice;
    }

    /**
     * Mark unread cards as read after they scroll above the viewport.
     */
    function markCardsReadAboveViewport() {
        if (!shouldUseTouchScrollRead()) {
            return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const containerTop = containerRect.top;

        getCards().forEach(card => {
            if (!(card instanceof HTMLElement) || isCardMarkedRead(card)) {
                return;
            }

            const rect = card.getBoundingClientRect();
            if (rect.bottom <= containerTop) {
                markCardRead(card);
            }
        });
    }

    /**
     * Queue one touch-scroll read check per animation frame.
     */
    function scheduleTouchScrollReadCheck() {
        if (!shouldUseTouchScrollRead() || touchScrollReadScheduled) {
            return;
        }

        touchScrollReadScheduled = true;
        window.requestAnimationFrame(() => {
            touchScrollReadScheduled = false;
            markCardsReadAboveViewport();
        });
    }

    /**
     * Create a fully rendered article card element.
     *
     * @param {Record<string, any>} article
     * @returns {HTMLElement}
     */
    function renderArticleCard(article) {
        const card = document.createElement("article");
        card.className = "feed-article-card site-card";
        card.dataset.articleId = String(article.article_id || "");
        card.dataset.articleLink = normalizeArticleLink(article.link);
        card.dataset.isRead = Boolean(article.is_read) ? "true" : "false";
        card.dataset.isSaved = Boolean(article.is_saved) ? "true" : "false";
        card.tabIndex = 0;

        const header = document.createElement("header");
        header.className = "feed-article-card-header";

        const leftMeta = document.createElement("div");
        leftMeta.className = "feed-article-meta-left";

        const categoryPill = document.createElement("span");
        categoryPill.className = "feed-category-pill";
        categoryPill.style.setProperty("--feed-category-color", String(article.category_color_hex || "#1F6FEB"));
        categoryPill.textContent = String(article.category_name || "Category");

        const sourceTitle = document.createElement("span");
        sourceTitle.className = "feed-source-title";
        sourceTitle.textContent = String(article.feed_title || "Feed");

        leftMeta.appendChild(categoryPill);
        leftMeta.appendChild(sourceTitle);

        const rightMeta = document.createElement("div");
        rightMeta.className = "feed-article-meta-right";
        if (article.published_at) {
            const parsedDate = parseArticleDate(String(article.published_at || ""));
            if (parsedDate instanceof Date) {
                const time = document.createElement("time");
                time.dateTime = parsedDate.toISOString();
                time.textContent = articleTimeFormatter.format(parsedDate);
                rightMeta.appendChild(time);
            }
        }

        header.appendChild(leftMeta);
        header.appendChild(rightMeta);

        const title = document.createElement("h5");
        title.className = "feed-article-title";

        const titleLink = document.createElement("a");
        titleLink.href = normalizeArticleLink(article.link) || "#";
        titleLink.target = "_blank";
        titleLink.rel = "noopener";
        titleLink.textContent = String(article.title || "Untitled");
        title.appendChild(titleLink);

        card.appendChild(header);
        card.appendChild(title);

        const mediaImageUrl = normalizeArticleLink(article.media_image_url);
        if (mediaImageUrl !== "") {
            const media = document.createElement("figure");
            media.className = "feed-article-media";

            const mediaImage = document.createElement("img");
            mediaImage.src = mediaImageUrl;
            mediaImage.alt = "";
            mediaImage.loading = "lazy";
            mediaImage.decoding = "async";
            mediaImage.referrerPolicy = "no-referrer";
            mediaImage.addEventListener("load", schedulePagePrefetchCheck, { once: true });
            mediaImage.addEventListener("error", schedulePagePrefetchCheck, { once: true });
            media.appendChild(mediaImage);

            card.appendChild(media);
        }

        const rawAuthorName = String(article.author || "").trim();
        const authorName = (rawAuthorName !== "" && rawAuthorName.toLowerCase() !== "none")
            ? rawAuthorName
            : String(article.feed_title || "").trim();
        if (authorName !== "") {
            const author = document.createElement("p");
            author.className = "feed-article-author";
            author.textContent = `By ${authorName}`;
            card.appendChild(author);
        }

        if (article.summary_html) {
            const summary = document.createElement("div");
            summary.className = "feed-article-summary";
            summary.innerHTML = String(article.summary_html);
            card.appendChild(summary);
        }

        setCardReadAppearance(card, Boolean(article.is_read));
        setCardSavedAppearance(card, Boolean(article.is_saved));

        return card;
    }

    /**
     * Render article response payload into the DOM.
     *
     * @param {{ articles?: Array<Record<string, any>> }} payload
     */
    function renderArticles(payload) {
        const incomingArticles = Array.isArray(payload.articles) ? payload.articles : [];
        const previousCards = getCards();
        const previousCardMap = new Map();
        const previousIdsInOrder = [];
        const previousSelectedId = getSelectedArticleId();
        const previousScrollY = window.scrollY;

        previousCards.forEach(card => {
            const articleId = getCardArticleId(card);
            if (articleId === "") {
                return;
            }

            previousIdsInOrder.push(articleId);
            previousCardMap.set(articleId, card);
        });

        const incomingById = new Map();
        const incomingIdsInOrder = [];
        incomingArticles.forEach(article => {
            const articleId = String(article.article_id || "").trim();
            if (articleId === "") {
                return;
            }

            incomingById.set(articleId, article);
            incomingIdsInOrder.push(articleId);
        });

        const retainedReadIds = (retainSessionReadCards && selectedCategory !== "saved")
            ? previousIdsInOrder.filter(
                articleId => {
                    if (incomingById.has(articleId)) {
                        return false;
                    }

                    if (sessionReadArticleIds.has(articleId)) {
                        return true;
                    }

                    const existingCard = previousCardMap.get(articleId);
                    return existingCard instanceof HTMLElement && isCardMarkedRead(existingCard);
                }
            )
            : [];

        const retainedUnsavedIds = selectedCategory === "saved"
            ? previousIdsInOrder.filter(articleId => !incomingById.has(articleId) && sessionUnsavedArticleIds.has(articleId))
            : [];

        const orderIndexById = new Map();
        incomingIdsInOrder.forEach((articleId, index) => {
            orderIndexById.set(articleId, index);
        });
        retainedReadIds.forEach((articleId, index) => {
            orderIndexById.set(articleId, incomingIdsInOrder.length + index);
        });

        retainedUnsavedIds.forEach((articleId, index) => {
            orderIndexById.set(articleId, incomingIdsInOrder.length + retainedReadIds.length + index);
        });

        const finalIds = Array.from(new Set([...incomingIdsInOrder, ...retainedReadIds, ...retainedUnsavedIds]));

        finalIds.sort((leftId, rightId) => {
            const leftArticle = incomingById.get(leftId);
            const rightArticle = incomingById.get(rightId);
            const leftCard = previousCardMap.get(leftId);
            const rightCard = previousCardMap.get(rightId);

            const leftTimestamp = leftArticle
                ? getArticlePublishedTimestamp(leftArticle)
                : (leftCard instanceof HTMLElement ? getCardPublishedTimestamp(leftCard) : Number.POSITIVE_INFINITY);
            const rightTimestamp = rightArticle
                ? getArticlePublishedTimestamp(rightArticle)
                : (rightCard instanceof HTMLElement ? getCardPublishedTimestamp(rightCard) : Number.POSITIVE_INFINITY);

            if (leftTimestamp !== rightTimestamp) {
                return leftTimestamp - rightTimestamp;
            }

            return (orderIndexById.get(leftId) ?? Number.MAX_SAFE_INTEGER)
                - (orderIndexById.get(rightId) ?? Number.MAX_SAFE_INTEGER);
        });

        incomingIdsInOrder.forEach(articleId => {
            const isAlreadyKnown = knownArticleIds.has(articleId);
            const isAlreadyVisible = previousCardMap.has(articleId);

            if (
                selectedStatus === "unread" &&
                !isAlreadyKnown &&
                !isAlreadyVisible &&
                hadKnownArticleHistory
            ) {
                newUnreadArticleIds.add(articleId);
            }

            knownArticleIds.add(articleId);
        });

        persistArticleIdState();

        const fragment = document.createDocumentFragment();

        finalIds.forEach(articleId => {
            const article = incomingById.get(articleId);
            const existingCard = previousCardMap.get(articleId);
            const card = existingCard || (article ? renderArticleCard(article) : null);
            if (!(card instanceof HTMLElement)) {
                return;
            }

            const isRead = article
                ? Boolean(article.is_read)
                : sessionReadArticleIds.has(articleId);
            if (isRead) {
                newUnreadArticleIds.delete(articleId);
            } else {
                sessionReadArticleIds.delete(articleId);
            }

            setCardReadAppearance(card, isRead);
            const isSaved = article
                ? Boolean(article.is_saved)
                : isCardSaved(card);
            setCardSavedAppearance(card, isSaved);
            setCardNewBadge(card, !isRead && newUnreadArticleIds.has(articleId));
            fragment.appendChild(card);
        });

        persistArticleIdState();

        if (finalIds.length === 0) {
            renderInlineEmptyHint();
            clearCardSelection();
            return;
        }

        articleList.classList.remove("is-empty");
        articleList.replaceChildren(fragment);
        refreshPagingSentinelObserver();

        if (previousSelectedId !== "") {
            const selectedIdIndex = finalIds.indexOf(previousSelectedId);
            if (selectedIdIndex >= 0) {
                setSelectedIndex(selectedIdIndex, { scrollIntoView: false });
                window.scrollTo({ top: previousScrollY, behavior: "auto" });
                return;
            }
        }

        if (selectedIndex >= 0) {
            const fallbackIndex = Math.min(selectedIndex, finalIds.length - 1);
            setSelectedIndex(fallbackIndex, { scrollIntoView: false });
        } else {
            clearCardSelection();
        }
        window.scrollTo({ top: previousScrollY, behavior: "auto" });
        scheduleTouchScrollReadCheck();
    }

    /**
     * Return count of cards positioned below current viewport.
     *
     * @returns {number}
     */
    function countCardsBelowViewport() {
        if (useElementScrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const containerBottom = containerRect.bottom;
            return getCards().filter(card => card.getBoundingClientRect().top > containerBottom).length;
        }

        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        return getCards().filter(card => card.getBoundingClientRect().top > viewportHeight).length;
    }

    /**
     * Return whether a card currently matches the active server-side filter.
     *
     * @param {HTMLElement} card
     * @returns {boolean}
     */
    function isCardIncludedByCurrentFilter(card) {
        const articleId = getCardArticleId(card);
        if (articleId === "") {
            return false;
        }

        if (selectedCategory === "saved") {
            return isCardSaved(card) && !pendingUnsaveIds.has(articleId);
        }

        if (selectedCategory === "recently-read" || selectedStatus === "read") {
            return isCardMarkedRead(card) && !pendingUnreadIds.has(articleId);
        }

        if (selectedStatus === "unread") {
            return !isCardMarkedRead(card) && !pendingReadIds.has(articleId);
        }

        return true;
    }

    /**
     * Compute the safest offset for the next paging request based on cards that
     * still match the active server-side filter. This avoids skipping pages when
     * local read/save toggles mutate what the backend would include.
     *
     * @returns {number}
     */
    function getPagingRequestOffset() {
        return getCards().filter(isCardIncludedByCurrentFilter).length;
    }

    /**
     * Build or return the paging sentinel element anchored at list end.
     *
     * @returns {HTMLElement}
     */
    function ensurePagingSentinelElement() {
        let sentinel = articleList.querySelector("#feeds-paging-sentinel");
        if (!(sentinel instanceof HTMLElement)) {
            sentinel = document.createElement("div");
            sentinel.id = "feeds-paging-sentinel";
            sentinel.className = "feeds-paging-sentinel";
            sentinel.setAttribute("aria-hidden", "true");
        }

        articleList.appendChild(sentinel);
        return sentinel;
    }

    /**
     * Ensure an observer watches the bottom sentinel for near-end prefetch.
     */
    function refreshPagingSentinelObserver() {
        if (!("IntersectionObserver" in window)) {
            return;
        }

        const sentinel = ensurePagingSentinelElement();

        if (!(pagingSentinelObserver instanceof IntersectionObserver)) {
            pagingSentinelObserver = new IntersectionObserver(
                entries => {
                    if (entries.some(entry => entry.isIntersecting)) {
                        schedulePagePrefetchCheck();
                    }
                },
                {
                    root: useElementScrollContainer ? scrollContainer : null,
                    rootMargin: "0px 0px 45% 0px",
                    threshold: 0,
                }
            );
        } else {
            pagingSentinelObserver.disconnect();
        }

        pagingSentinelObserver.observe(sentinel);
    }

    /**
     * Queue a delayed retry after paging request failures.
     */
    function schedulePageLoadRetry() {
        if (pageLoadRetryTimerId !== null) {
            return;
        }

        pageLoadRetryTimerId = window.setTimeout(() => {
            pageLoadRetryTimerId = null;
            schedulePagePrefetchCheck();
        }, pageLoadRetryDelayMs);
    }

    /**
     * Cancel pending delayed paging retry, if any.
     */
    function clearPageLoadRetry() {
        if (pageLoadRetryTimerId === null) {
            return;
        }

        window.clearTimeout(pageLoadRetryTimerId);
        pageLoadRetryTimerId = null;
    }

    /**
     * Start a periodic watchdog so paging cannot stall waiting for a scroll event.
     */
    function startPagingWatchdog() {
        if (pagingWatchdogTimerId !== null) {
            return;
        }

        pagingWatchdogTimerId = window.setInterval(() => {
            if (document.hidden || !hasMorePages || pageLoadInFlight) {
                return;
            }

            schedulePagePrefetchCheck();
        }, pagingWatchdogIntervalMs);
    }

    /**
     * Append one fetched page of article cards without replacing existing list state.
     *
     * @param {{ articles?: Array<Record<string, any>>, has_more?: boolean, next_offset?: number }} payload
     * @param {number} requestOffset
     * @returns {number}
     */
    function appendArticlePage(payload, requestOffset) {
        const incomingArticles = Array.isArray(payload.articles) ? payload.articles : [];

        if (incomingArticles.length === 0) {
            hasMorePages = Boolean(payload.has_more);
            if (typeof payload.next_offset === "number") {
                nextOffset = Math.max(0, payload.next_offset);
            } else {
                nextOffset = Math.max(0, requestOffset);
            }
            return 0;
        }

        const fragment = document.createDocumentFragment();

        incomingArticles.forEach(article => {
            const articleId = String(article.article_id || "").trim();
            if (articleId === "") {
                return;
            }

            if (articleList.querySelector(`.feed-article-card[data-article-id="${CSS.escape(articleId)}"]`)) {
                return;
            }

            const card = renderArticleCard(article);
            const isRead = Boolean(article.is_read);
            const isSaved = Boolean(article.is_saved);

            if (
                selectedStatus === "unread" &&
                !knownArticleIds.has(articleId) &&
                hadKnownArticleHistory
            ) {
                newUnreadArticleIds.add(articleId);
            }

            if (isRead) {
                newUnreadArticleIds.delete(articleId);
            } else {
                sessionReadArticleIds.delete(articleId);
            }

            knownArticleIds.add(articleId);
            setCardReadAppearance(card, isRead);
            setCardSavedAppearance(card, isSaved);
            setCardNewBadge(card, !isRead && newUnreadArticleIds.has(articleId));
            fragment.appendChild(card);
        });

        if (fragment.childNodes.length > 0) {
            articleList.classList.remove("is-empty");
            const emptyHint = articleList.querySelector("#feeds-empty-hint");
            if (emptyHint) {
                emptyHint.remove();
            }
            articleList.appendChild(fragment);
        }

        const appendedCount = fragment.childNodes.length;

        persistArticleIdState();

        hasMorePages = Boolean(payload.has_more);
        if (typeof payload.next_offset === "number") {
            nextOffset = Math.max(0, payload.next_offset);
        } else {
            nextOffset = Math.max(0, requestOffset + incomingArticles.length);
        }

        refreshPagingSentinelObserver();
        return appendedCount;
    }

    /**
     * Load and append the next article page.
     *
     * @returns {Promise<void>}
     */
    async function loadNextPage() {
        if (!hasMorePages || pageLoadInFlight) {
            return;
        }

        pageLoadInFlight = true;
        const requestOffset = getPagingRequestOffset();

        try {
            const response = await fetch(buildArticlesUrl(requestOffset, pageSize), {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                schedulePageLoadRetry();
                return;
            }

            const payload = await response.json();
            clearPageLoadRetry();
            appendArticlePage(payload, requestOffset);
            scheduleTouchScrollReadCheck();
        } catch (_error) {
            // Keep current list if paging request fails.
            schedulePageLoadRetry();
        } finally {
            pageLoadInFlight = false;
            schedulePagePrefetchCheck();
        }
    }

    /**
     * Prefetch next page when only a small number of unseen cards remain.
     *
     * @returns {Promise<void>}
     */
    async function maybePrefetchNextPage() {
        for (let cycle = 0; cycle < maxAutoPagesPerCycle; cycle += 1) {
            if (!hasMorePages || pageLoadInFlight) {
                return;
            }

            if (countCardsBelowViewport() > prefetchRemainingThreshold) {
                return;
            }

            const previousOffset = nextOffset;
            const previousCardCount = getCards().length;
            await loadNextPage();

            const currentCardCount = getCards().length;
            if (nextOffset === previousOffset && currentCardCount === previousCardCount) {
                return;
            }
        }
    }

    /**
     * Queue a prefetch check on next animation frame.
     */
    function schedulePagePrefetchCheck() {
        if (pagePrefetchScheduled) {
            return;
        }

        pagePrefetchScheduled = true;
        window.requestAnimationFrame(async () => {
            pagePrefetchScheduled = false;
            await maybePrefetchNextPage();
        });
    }

    /**
     * Initialize known/new article badge state from SSR-rendered cards.
     */
    function initializeArticleBadgeStateFromSsr() {
        const cards = getCards();
        cards.forEach(card => {
            const articleId = getCardArticleId(card);
            if (articleId === "") {
                return;
            }

            const isRead = isCardMarkedRead(card);
            const isSaved = isCardSaved(card);

            if (!isRead && selectedStatus === "unread" && !knownArticleIds.has(articleId) && hadKnownArticleHistory) {
                newUnreadArticleIds.add(articleId);
            }

            if (isRead) {
                newUnreadArticleIds.delete(articleId);
            }

            knownArticleIds.add(articleId);
            setCardReadAppearance(card, isRead);
            setCardSavedAppearance(card, isSaved);
            setCardNewBadge(card, !isRead && newUnreadArticleIds.has(articleId));
        });

        persistArticleIdState();
    }

    /**
     * Ensure the currently active sidebar category link remains highlighted.
     */
    function syncSidebarSelection() {
        const activeCategory = selectedCategory;
        const sidebarLinks = document.querySelectorAll(
            ".right-sidebar .sub-level-nav[data-category-shortcut], .right-sidebar .feed-category-link[data-category-id]"
        );

        sidebarLinks.forEach(link => {
            if (!(link instanceof HTMLElement)) {
                return;
            }

            const shortcutId = String(link.dataset.categoryShortcut || "").trim();
            const categoryId = String(link.dataset.categoryId || "").trim();
            const linkCategory = shortcutId || categoryId;
            const isCurrent = linkCategory !== "" && linkCategory === activeCategory;

            link.classList.toggle("is-current", isCurrent);
            if (isCurrent) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    }

    /**
     * Update right-sidebar category count labels.
     *
      * @param {{ all_unread_count?: number, recently_read_count?: number, saved_count?: number, categories?: Array<Record<string, any>> }} payload
     */
    function updateSidebarCounts(payload) {
        const allLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="all"]');
        const recentlyReadLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="recently-read"]');
          const savedLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="saved"]');

        if (allLink) {
            const allCountNode = allLink.querySelector(".feed-category-count");
            if (allCountNode) {
                allCountNode.textContent = String(Number(payload.all_unread_count || 0));
            }
        }
        if (recentlyReadLink) {
            // Recently Read intentionally has no unread-count badge.
        }
        if (savedLink) {
            const savedCountNode = savedLink.querySelector(".feed-category-count");
            if (savedCountNode) {
                savedCountNode.textContent = String(Number(payload.saved_count || 0));
            }
        }

        const categories = Array.isArray(payload.categories) ? payload.categories : [];
        categories.forEach(category => {
            const categoryId = String(category.category_id || "");
            const link = document.querySelector(`.feed-category-link[data-category-id="${CSS.escape(categoryId)}"]`);
            if (!link) {
                return;
            }

            const countNode = link.querySelector(".feed-category-count");
            if (countNode) {
                countNode.textContent = String(Number(category.unread_count || 0));
            }

            link.classList.toggle("is-muted", Boolean(category.muted));
            if (countNode instanceof HTMLElement) {
                countNode.style.setProperty("--feed-category-accent", String(category.color_hex || "#1F6FEB"));
            }
        });

        syncSidebarSelection();
    }

    /**
     * Refresh sidebar counts only.
     *
     * @returns {Promise<void>}
     */
    async function refreshSidebarCounts() {
        try {
            const response = await fetch(categoriesEndpoint, {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            updateSidebarCounts(payload);
        } catch (_error) {
            // Keep existing sidebar data when refresh fails.
        }
    }

    /**
     * Refresh categories and article list from API.
     *
     * @returns {Promise<void>}
     */
    async function refreshFeedData() {
        try {
            const [categoryResponse, articleResponse] = await Promise.all([
                fetch(categoriesEndpoint, {
                    method: "GET",
                    cache: "no-store",
                }),
                fetch(buildArticlesUrl(0, Math.max(getCards().length, pageSize)), {
                    method: "GET",
                    cache: "no-store",
                }),
            ]);

            if (!categoryResponse.ok || !articleResponse.ok) {
                return;
            }

            const [categoryPayload, articlePayload] = await Promise.all([
                categoryResponse.json(),
                articleResponse.json(),
            ]);

            updateSidebarCounts(categoryPayload);
            renderArticles(articlePayload);
        } catch (_error) {
            // Keep current state if refresh fails.
        }
    }

    /**
     * Probe the currently-visible server-filtered article window and refresh when
     * server ordering or membership diverges (including timed removals).
     *
     * @returns {Promise<void>}
     */
    async function refreshHeadArticlesIfNeeded() {
        if (headRefreshProbeInFlight) {
            return;
        }

        const currentCardIds = getCards()
            .map(getCardArticleId)
            .filter(articleId => articleId !== "");

        headRefreshProbeInFlight = true;

        try {
            const refreshLimit = Math.max(currentCardIds.length, pageSize);
            const probeResponse = await fetch(buildArticlesUrl(0, refreshLimit), {
                method: "GET",
                cache: "no-store",
            });
            if (!probeResponse.ok) {
                return;
            }

            const probePayload = await probeResponse.json();
            const probeArticles = Array.isArray(probePayload.articles) ? probePayload.articles : [];
            const probeIds = probeArticles
                .map(article => String(article.article_id || "").trim())
                .filter(articleId => articleId !== "");

            if (
                probeIds.length === currentCardIds.length
                && probeIds.every((articleId, index) => articleId === currentCardIds[index])
            ) {
                return;
            }

            renderArticles(probePayload);

            if (typeof probePayload.has_more === "boolean") {
                hasMorePages = probePayload.has_more;
            }
            if (typeof probePayload.next_offset === "number") {
                nextOffset = Math.max(0, probePayload.next_offset);
            } else {
                nextOffset = Math.max(0, getPagingRequestOffset());
            }

            refreshPagingSentinelObserver();
            scheduleTouchScrollReadCheck();
            schedulePagePrefetchCheck();
        } catch (_error) {
            // Keep current list if top-of-list probe fails.
        } finally {
            headRefreshProbeInFlight = false;
        }
    }

    /**
     * Sync read/unread state for currently rendered cards without replacing/removing cards.
     *
     * @returns {Promise<void>}
     */
    async function refreshVisibleCardStatuses() {
        const cards = getCards();
        if (cards.length === 0) {
            return;
        }

        const articleIds = cards
            .map(getCardArticleId)
            .filter(articleId => articleId !== "");

        if (articleIds.length === 0) {
            return;
        }

        try {
            const response = await fetch(articleStatusesEndpoint, {
                method: "POST",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ article_ids: articleIds }),
            });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            const incomingStatuses = Array.isArray(payload.statuses) ? payload.statuses : [];
            const statusById = new Map(
                incomingStatuses
                    .map(status => [
                        String(status.article_id || "").trim(),
                        {
                            isRead: Boolean(status.is_read),
                            isSaved: Boolean(status.is_saved),
                        },
                    ])
                    .filter(([articleId]) => articleId !== "")
            );

            cards.forEach(card => {
                const articleId = getCardArticleId(card);
                if (articleId === "") {
                    return;
                }

                if (
                    pendingReadIds.has(articleId)
                    || pendingUnreadIds.has(articleId)
                    || pendingSaveIds.has(articleId)
                    || pendingUnsaveIds.has(articleId)
                ) {
                    return;
                }

                if (!statusById.has(articleId)) {
                    return;
                }

                const status = statusById.get(articleId);
                if (!status || typeof status !== "object") {
                    return;
                }

                const isRead = Boolean(status.isRead);
                const isSaved = Boolean(status.isSaved);
                if (retainSessionReadCards && isRead) {
                    sessionReadArticleIds.add(articleId);
                } else if (!isRead) {
                    sessionReadArticleIds.delete(articleId);
                }

                setCardReadAppearance(card, isRead);
                setCardSavedAppearance(card, isSaved);
                setCardNewBadge(card, !isRead && newUnreadArticleIds.has(articleId));
            });
        } catch (_error) {
            // Keep existing card states when status sync fails.
        }
    }

    /**
     * When the list has reached the end, poll for newly-arrived articles that
     * should be appended in-order without requiring a full page refresh.
     *
     * @returns {Promise<void>}
     */
    async function refreshTailArticlesWhenAtEnd() {
        if (hasMorePages || pageLoadInFlight || tailRefreshInFlight) {
            return;
        }

        const nowMs = Date.now();
        if (nowMs - lastTailRefreshAtMs < tailRefreshMinIntervalMs) {
            return;
        }

        tailRefreshInFlight = true;
        lastTailRefreshAtMs = nowMs;

        const requestOffset = getPagingRequestOffset();

        try {
            const response = await fetch(buildArticlesUrl(requestOffset, pageSize), {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            const incomingArticles = Array.isArray(payload.articles) ? payload.articles : [];

            if (incomingArticles.length === 0) {
                hasMorePages = Boolean(payload.has_more);
                if (typeof payload.next_offset === "number") {
                    nextOffset = Math.max(0, payload.next_offset);
                }

                if (hasMorePages) {
                    schedulePagePrefetchCheck();
                } else {
                    await refreshHeadArticlesIfNeeded();
                }
                return;
            }

            const appendedCount = appendArticlePage(payload, requestOffset);
            if (appendedCount === 0) {
                await refreshHeadArticlesIfNeeded();
            }
            scheduleTouchScrollReadCheck();
            schedulePagePrefetchCheck();
        } catch (_error) {
            // Keep current list if tail refresh fails.
        } finally {
            tailRefreshInFlight = false;
        }
    }

    /**
     * Poll sidebar counts and in-place card status state for cross-device sync.
     *
     * @returns {Promise<void>}
     */
    async function refreshLiveReaderState() {
        await Promise.all([
            refreshSidebarCounts(),
            refreshVisibleCardStatuses(),
        ]);
        await refreshHeadArticlesIfNeeded();
        await refreshTailArticlesWhenAtEnd();
    }

    /**
     * Handle keyboard shortcuts for article navigation.
     *
     * @param {KeyboardEvent} event
     */
    function onKeyDown(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) {
            return;
        }

        const cards = getCards();
        if (cards.length === 0) {
            return;
        }

        if (event.key === "j") {
            event.preventDefault();
            setSelectedIndex(selectedIndex + 1, {
                markReadOnSelect: true,
                scrollMode: "top-always",
            });
            return;
        }

        if (event.key === "k") {
            event.preventDefault();
            setSelectedIndex(selectedIndex - 1, {
                markReadOnSelect: true,
                scrollMode: "top-always",
            });
            return;
        }

        if (event.key === "Enter" || event.key === " ") {
            if (selectedIndex < 0) {
                return;
            }
            event.preventDefault();
            const card = cards[selectedIndex];
            openAndMarkCard(card);
        }
    }

    articleList.addEventListener("click", event => {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target) {
            return;
        }

        // Do not treat unread-button clicks as card selection/read actions.
        if (target.closest(".feed-article-unread-button") || target.closest(".feed-article-save-button")) {
            return;
        }

        const card = target.closest(".feed-article-card");
        if (!(card instanceof HTMLElement)) {
            return;
        }

        const cards = getCards();
        const index = cards.indexOf(card);
        if (index >= 0) {
            setSelectedIndex(index, { markReadOnSelect: true, scrollIntoView: false });
        }
    });

    articleList.addEventListener("focusin", event => {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target) {
            return;
        }

        const card = target.closest(".feed-article-card");
        if (!(card instanceof HTMLElement)) {
            return;
        }

        const cards = getCards();
        const index = cards.indexOf(card);
        if (index >= 0) {
            selectedIndex = index;
            cards.forEach((entry, idx) => entry.classList.toggle("is-selected", idx === index));
        }
    });

    if (useElementScrollContainer) {
        scrollContainer.addEventListener("scroll", schedulePagePrefetchCheck, { passive: true });
    }
    window.addEventListener("scroll", schedulePagePrefetchCheck, { passive: true });
    window.addEventListener("resize", schedulePagePrefetchCheck, { passive: true });
    window.addEventListener("orientationchange", schedulePagePrefetchCheck, { passive: true });

    if (isTouchOnlyDevice) {
        window.addEventListener("touchmove", schedulePagePrefetchCheck, { passive: true });
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            schedulePagePrefetchCheck();
        }
    });

    document.addEventListener("keydown", onKeyDown);

    if (isTouchOnlyDevice) {
        window.addEventListener("scroll", scheduleTouchScrollReadCheck, { passive: true });
        window.addEventListener("touchmove", scheduleTouchScrollReadCheck, { passive: true });
    }

    // Initialize card selection from SSR content and start polling.
    initializeArticleBadgeStateFromSsr();
    localizeTimeNodes(articleList);
    syncSidebarSelection();

    clearCardSelection();
    refreshPagingSentinelObserver();
    startPagingWatchdog();
    scheduleTouchScrollReadCheck();
    schedulePagePrefetchCheck();

    window.setInterval(refreshLiveReaderState, 2000);
})();
