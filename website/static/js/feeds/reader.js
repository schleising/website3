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

    /** @type {string} */
    const selectedCategory = root.dataset.selectedCategory || "all";
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

    /** @type {number} */
    let selectedIndex = -1;

    /** @type {Set<string>} */
    const pendingReadIds = new Set();

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
     * Extract card article ID.
     *
     * @param {HTMLElement} card
     * @returns {string}
     */
    function getCardArticleId(card) {
        return String(card.dataset.articleId || "").trim();
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
            cards[boundedIndex].scrollIntoView({ block: "nearest" });
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
     * Open a card link in a new tab and mark it read.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function openAndMarkCard(card) {
        const link = card.dataset.articleLink || "";
        if (link !== "") {
            window.open(link, "_blank", "noopener");
        }

        await markCardRead(card);
    }

    /**
     * Mark a card as read through the API and remove it from DOM.
     *
     * @param {HTMLElement} card
     * @returns {Promise<void>}
     */
    async function markCardRead(card) {
        const articleId = card.dataset.articleId || "";
        if (articleId === "") {
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

            newUnreadArticleIds.delete(articleId);
            persistArticleIdState();

            if (selectedStatus === "unread") {
                card.remove();

                const cards = getCards();
                if (cards.length === 0) {
                    selectedIndex = -1;
                    return;
                }

                setSelectedIndex(
                    Math.min(selectedIndex, cards.length - 1),
                    { scrollIntoView: false }
                );
                return;
            }

            setCardNewBadge(card, false);
        } finally {
            pendingReadIds.delete(articleId);
        }
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
            const date = new Date(article.published_at);
            const time = document.createElement("time");
            time.dateTime = date.toISOString();
            time.textContent = date.toLocaleString();
            rightMeta.appendChild(time);
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

        if (article.author) {
            const author = document.createElement("p");
            author.className = "feed-article-author";
            author.textContent = `By ${String(article.author)}`;
            card.appendChild(author);
        }

        if (article.summary_html) {
            const summary = document.createElement("div");
            summary.className = "feed-article-summary";
            summary.innerHTML = String(article.summary_html);
            card.appendChild(summary);
        }

        const actions = document.createElement("footer");
        actions.className = "feed-article-actions";

        const markButton = document.createElement("button");
        markButton.type = "button";
        markButton.className = "btn btn-primary feed-mark-read-button";
        markButton.textContent = "Mark Read";

        const openButton = document.createElement("a");
        openButton.href = String(article.link || "#");
        openButton.target = "_blank";
        openButton.rel = "noopener";
        openButton.className = "btn btn-primary";
        openButton.textContent = "Open";

        actions.appendChild(markButton);
        actions.appendChild(openButton);
        card.appendChild(actions);

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

        if (incomingIdsInOrder.length === 0) {
            articleList.innerHTML = "";
            const emptyState = document.createElement("article");
            emptyState.className = "feed-empty-state site-card";
            emptyState.innerHTML = "<h5>No articles available</h5><p>Add subscriptions in Settings or try a different filter.</p>";
            articleList.appendChild(emptyState);
            selectedIndex = -1;
            return;
        }

        const finalIds = previousIdsInOrder
            .filter(articleId => incomingById.has(articleId))
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
            if (!article) {
                return;
            }

            const existingCard = previousCardMap.get(articleId);
            const card = existingCard || renderArticleCard(article);
            const isUnread = !Boolean(article.is_read);
            setCardNewBadge(card, isUnread && newUnreadArticleIds.has(articleId));
            fragment.appendChild(card);
        });

        articleList.replaceChildren(fragment);

        if (finalIds.length === 0) {
            selectedIndex = -1;
            return;
        }

        if (previousSelectedId !== "") {
            const selectedIdIndex = finalIds.indexOf(previousSelectedId);
            if (selectedIdIndex >= 0) {
                setSelectedIndex(selectedIdIndex, { scrollIntoView: false });
                window.scrollTo({ top: previousScrollY, behavior: "auto" });
                return;
            }
        }

        const fallbackIndex = selectedIndex >= 0 ? Math.min(selectedIndex, finalIds.length - 1) : 0;
        setSelectedIndex(fallbackIndex, { scrollIntoView: false });
        window.scrollTo({ top: previousScrollY, behavior: "auto" });
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

            if (selectedStatus === "unread" && !knownArticleIds.has(articleId) && hadKnownArticleHistory) {
                newUnreadArticleIds.add(articleId);
            }

            knownArticleIds.add(articleId);
            setCardNewBadge(card, newUnreadArticleIds.has(articleId));
        });

        persistArticleIdState();
    }

    /**
     * Update right-sidebar category count labels.
     *
     * @param {{ all_unread_count?: number, recently_read_count?: number, categories?: Array<Record<string, any>> }} payload
     */
    function updateSidebarCounts(payload) {
        const allLink = document.querySelector('a[href="/feeds/?category=all"]');
        const recentlyReadLink = document.querySelector('a[href="/feeds/?category=recently-read"]');

        if (allLink) {
            allLink.textContent = `All Feeds (${Number(payload.all_unread_count || 0)})`;
        }
        if (recentlyReadLink) {
            recentlyReadLink.textContent = `Recently Read (${Number(payload.recently_read_count || 0)})`;
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
                countNode.textContent = `(${Number(category.unread_count || 0)})`;
            }

            link.classList.toggle("is-muted", Boolean(category.muted));
            const colorNode = link.querySelector(".feed-category-color");
            if (colorNode instanceof HTMLElement) {
                colorNode.style.backgroundColor = String(category.color_hex || "#1F6FEB");
            }
        });
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
            setSelectedIndex(selectedIndex + 1, { markReadOnSelect: true });
            return;
        }

        if (event.key === "k") {
            event.preventDefault();
            setSelectedIndex(selectedIndex - 1, { markReadOnSelect: true });
            return;
        }

        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const card = cards[selectedIndex >= 0 ? selectedIndex : 0];
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

        if (target.classList.contains("feed-mark-read-button")) {
            event.preventDefault();
            markCardRead(card);
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

    // Initialize card selection from SSR content and start polling.
    initializeArticleBadgeStateFromSsr();

    if (getCards().length > 0) {
        setSelectedIndex(0, { scrollIntoView: false });
    }

    window.setInterval(refreshFeedData, 10000);
})();
