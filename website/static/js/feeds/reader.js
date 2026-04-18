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
    const categoriesEndpoint = root.dataset.categoriesEndpoint || "/feeds/api/categories/";
    /** @type {string} */
    const markReadEndpointTemplate = root.dataset.markReadEndpointTemplate || "";
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
        : "No unread articles in this view.";

    /** @type {number} */
    let selectedIndex = -1;

    /** @type {boolean} */
    const retainSessionReadCards = selectedStatus === "unread";

    /** @type {Set<string>} */
    const pendingReadIds = new Set();

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
    function buildArticlesUrl() {
        const params = new URLSearchParams();
        params.set("category", selectedCategory);
        params.set("status_filter", selectedStatus);
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
        const hint = document.createElement("p");
        hint.className = "feeds-empty-hint";
        hint.id = "feeds-empty-hint";
        hint.textContent = emptyHintMessage;
        articleList.appendChild(hint);
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
     * Return whether a card is already marked read in current UI state.
     *
     * @param {HTMLElement} card
     * @returns {boolean}
     */
    function isCardMarkedRead(card) {
        return card.dataset.isRead === "true" || card.classList.contains("is-read-article");
    }

    /**
     * Apply read styling state for a card.
     *
     * @param {HTMLElement} card
     * @param {boolean} isRead
     */
    function setCardReadAppearance(card, isRead) {
        card.dataset.isRead = isRead ? "true" : "false";
        card.classList.toggle("is-read-article", isRead);
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
     * Open a URL in a new tab while preserving reader focus where the browser allows it.
     *
     * @param {string} link
     * @returns {void}
     */
    function openInBackgroundTab(link) {
        if (link === "") {
            return;
        }

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const openLink = document.createElement("a");
        openLink.href = link;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.style.position = "fixed";
        openLink.style.left = "-9999px";
        openLink.style.width = "1px";
        openLink.style.height = "1px";
        openLink.style.opacity = "0";
        document.body.appendChild(openLink);

        const openEvent = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            altKey: false,
        });
        openLink.dispatchEvent(openEvent);
        openLink.remove();

        const restoreReaderFocus = () => {
            window.focus();
            if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };

        restoreReaderFocus();

        window.setTimeout(() => {
            restoreReaderFocus();
        }, 0);

        window.setTimeout(() => {
            restoreReaderFocus();
        }, 75);

        window.setTimeout(() => {
            restoreReaderFocus();
        }, 180);
    }

    /**
     * Open a card link in a new tab and mark it read.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function openAndMarkCard(card) {
        const link = card.dataset.articleLink || "";
        openInBackgroundTab(link);

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

        if (pendingReadIds.has(articleId)) {
            return;
        }

        pendingReadIds.add(articleId);

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
        } finally {
            pendingReadIds.delete(articleId);
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
        card.dataset.articleLink = String(article.link || "");
        card.dataset.isRead = Boolean(article.is_read) ? "true" : "false";
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
        titleLink.href = String(article.link || "#");
        titleLink.target = "_blank";
        titleLink.rel = "noopener";
        titleLink.textContent = String(article.title || "Untitled");
        title.appendChild(titleLink);

        card.appendChild(header);
        card.appendChild(title);

        if (article.media_image_url) {
            const media = document.createElement("figure");
            media.className = "feed-article-media";

            const mediaImage = document.createElement("img");
            mediaImage.src = String(article.media_image_url);
            mediaImage.alt = "";
            mediaImage.loading = "lazy";
            mediaImage.decoding = "async";
            mediaImage.referrerPolicy = "no-referrer";
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

        if (selectedStatus === "unread") {
            previousIdsInOrder
                .filter(articleId => !incomingById.has(articleId))
                .forEach(articleId => {
                    sessionReadArticleIds.add(articleId);
                    newUnreadArticleIds.delete(articleId);
                });
        }

        const finalIds = previousIdsInOrder
            .filter(articleId => (
                incomingById.has(articleId)
                || selectedStatus === "unread"
                || (retainSessionReadCards && sessionReadArticleIds.has(articleId))
            ))
            .concat(incomingIdsInOrder.filter(articleId => !previousCardMap.has(articleId)));

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

            const isRead = sessionReadArticleIds.has(articleId) || Boolean(article && article.is_read);
            if (isRead) {
                newUnreadArticleIds.delete(articleId);
            }

            setCardReadAppearance(card, isRead);
            setCardNewBadge(card, !isRead && newUnreadArticleIds.has(articleId));
            fragment.appendChild(card);
        });

        persistArticleIdState();

        if (finalIds.length === 0) {
            renderInlineEmptyHint();
            clearCardSelection();
            return;
        }

        articleList.replaceChildren(fragment);

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

            if (!isRead && selectedStatus === "unread" && !knownArticleIds.has(articleId) && hadKnownArticleHistory) {
                newUnreadArticleIds.add(articleId);
            }

            if (isRead) {
                newUnreadArticleIds.delete(articleId);
            }

            knownArticleIds.add(articleId);
            setCardReadAppearance(card, isRead);
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
     * @param {{ all_unread_count?: number, recently_read_count?: number, categories?: Array<Record<string, any>> }} payload
     */
    function updateSidebarCounts(payload) {
        const allLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="all"]');
        const recentlyReadLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="recently-read"]');

        if (allLink) {
            const allCountNode = allLink.querySelector(".feed-category-count");
            if (allCountNode) {
                allCountNode.textContent = String(Number(payload.all_unread_count || 0));
            }
        }
        if (recentlyReadLink) {
            // Recently Read intentionally has no unread-count badge.
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
            const response = await fetch(categoriesEndpoint, { method: "GET" });
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
                fetch(categoriesEndpoint, { method: "GET" }),
                fetch(buildArticlesUrl(), { method: "GET" }),
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
    scheduleTouchScrollReadCheck();

    window.setInterval(refreshFeedData, 2000);
})();
