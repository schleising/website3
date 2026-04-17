/**
 * Feed settings page controller.
 */
(function () {
    "use strict";

    /** @type {HTMLElement | null} */
    const root = document.getElementById("feeds-settings-root");
    if (!root) {
        return;
    }

    /** @type {HTMLFormElement | null} */
    const addForm = document.getElementById("feed-add-form");
    /** @type {HTMLFormElement | null} */
    const opmlForm = document.getElementById("feed-opml-import-form");
    /** @type {HTMLElement | null} */
    const categoryList = document.getElementById("feed-category-settings-list");
    /** @type {HTMLElement | null} */
    const statusNode = document.getElementById("feed-settings-status");

    /** @type {string} */
    const categoriesEndpoint = root.dataset.categoriesEndpoint || "/feeds/api/categories/";
    /** @type {string} */
    const subscriptionEndpoint = root.dataset.subscriptionEndpoint || "/feeds/api/subscriptions/";
    /** @type {string} */
    const opmlImportEndpoint = root.dataset.opmlImportEndpoint || "/feeds/api/opml/import/";
    /** @type {string} */
    const categoryMuteTemplate = root.dataset.categoryMuteTemplate || "";
    /** @type {string} */
    const categoryUnmuteTemplate = root.dataset.categoryUnmuteTemplate || "";
    /** @type {string} */
    const categoryColorTemplate = root.dataset.categoryColorTemplate || "";
    /** @type {string} */
    const csrfToken = root.dataset.csrfToken || "";

    /**
     * Set user-facing status text.
     *
     * @param {string} message
     * @param {boolean} [isError]
     */
    function setStatus(message, isError = false) {
        if (!statusNode) {
            return;
        }

        statusNode.textContent = message;
        statusNode.classList.toggle("is-error", isError);
    }

    /**
     * Send JSON request and parse response payload.
     *
     * @param {string} url
     * @param {string} method
     * @param {Record<string, any>} payload
     * @returns {Promise<Record<string, any>>}
     */
    async function requestJson(url, method, payload) {
        const response = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify(payload),
        });

        let body = {};
        try {
            body = await response.json();
        } catch (_error) {
            body = {};
        }

        if (!response.ok) {
            const detail = typeof body.detail === "string" ? body.detail : `Request failed (${response.status})`;
            throw new Error(detail);
        }

        return body;
    }

    /**
     * Build endpoint from category template and category id.
     *
     * @param {string} template
     * @param {string} categoryId
     * @returns {string}
     */
    function categoryEndpoint(template, categoryId) {
        return template.replace("__CATEGORY_ID__", encodeURIComponent(categoryId));
    }

    /**
     * Reload page after settings mutation to keep SSR and sidebar in sync.
     */
    function reloadPageSoon() {
        window.setTimeout(() => {
            window.location.reload();
        }, 450);
    }

    /**
     * Update right-sidebar category color chip without reloading.
     *
     * @param {string} categoryId
     * @param {string} colorHex
     */
    function updateSidebarCategoryColor(categoryId, colorHex) {
        if (categoryId === "") {
            return;
        }

        const link = document.querySelector(`.feed-category-link[data-category-id="${CSS.escape(categoryId)}"]`);
        if (!(link instanceof HTMLElement)) {
            return;
        }

        const colorChip = link.querySelector(".feed-category-color");
        if (colorChip instanceof HTMLElement) {
            colorChip.style.backgroundColor = colorHex;
        }
    }

    /**
     * Handle subscription creation form submit.
     *
     * @param {SubmitEvent} event
     */
    async function onAddSubscription(event) {
        event.preventDefault();

        if (!addForm) {
            return;
        }

        const formData = new FormData(addForm);
        const feedUrl = String(formData.get("feed_url") || "").trim();
        const categoryName = String(formData.get("category_name") || "").trim();

        if (feedUrl === "" || categoryName === "") {
            setStatus("Feed URL and category are required.", true);
            return;
        }

        setStatus("Adding subscription...");

        try {
            await requestJson(subscriptionEndpoint, "POST", {
                feed_url: feedUrl,
                category_name: categoryName,
            });
            setStatus("Subscription added.");
            reloadPageSoon();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to add subscription.", true);
        }
    }

    /**
     * Handle OPML import form submit.
     *
     * @param {SubmitEvent} event
     */
    async function onImportOpml(event) {
        event.preventDefault();

        if (!opmlForm) {
            return;
        }

        const formData = new FormData(opmlForm);
        if (!(formData.get("opml_file") instanceof File)) {
            setStatus("Please choose an OPML file to import.", true);
            return;
        }

        formData.append("duplicate_policy", "skip");
        formData.append("default_category_name", "Imported");

        setStatus("Importing OPML...");

        try {
            const response = await fetch(opmlImportEndpoint, {
                method: "POST",
                headers: {
                    "X-CSRF-Token": csrfToken,
                },
                body: formData,
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(typeof payload.detail === "string" ? payload.detail : "OPML import failed.");
            }

            const createdCount = Number(payload.created_subscriptions || 0);
            const skippedCount = Number(payload.skipped_duplicates || 0);
            setStatus(`Import complete: ${createdCount} created, ${skippedCount} skipped.`);
            reloadPageSoon();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to import OPML.", true);
        }
    }

    /**
     * Handle mute/unmute actions for category buttons.
     *
     * @param {MouseEvent} event
     */
    async function onCategoryButtonClick(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target || !target.classList.contains("feed-category-mute-button")) {
            return;
        }

        const item = target.closest(".feed-category-settings-item");
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const categoryId = item.dataset.categoryId || "";
        if (categoryId === "") {
            return;
        }

        const currentlyMuted = target.dataset.muted === "true";
        const endpoint = currentlyMuted
            ? categoryEndpoint(categoryUnmuteTemplate, categoryId)
            : categoryEndpoint(categoryMuteTemplate, categoryId);

        setStatus(currentlyMuted ? "Unmuting category..." : "Muting category...");

        try {
            const payload = await requestJson(endpoint, "POST", {});
            const nowMuted = Boolean(payload.muted);
            target.dataset.muted = nowMuted ? "true" : "false";
            target.textContent = nowMuted ? "Unmute" : "Mute";
            setStatus(nowMuted ? "Category muted." : "Category unmuted.");
            reloadPageSoon();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to update category mute state.", true);
        }
    }

    /**
     * Handle category color updates.
     *
     * @param {Event} event
     */
    async function onCategoryColorChange(event) {
        const target = /** @type {HTMLInputElement | null} */ (event.target instanceof HTMLInputElement ? event.target : null);
        if (!target || !target.classList.contains("feed-category-color-input")) {
            return;
        }

        const item = target.closest(".feed-category-settings-item");
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const categoryId = item.dataset.categoryId || "";
        if (categoryId === "") {
            return;
        }

        const endpoint = categoryEndpoint(categoryColorTemplate, categoryId);

        setStatus("Updating category color...");

        try {
            const payload = await requestJson(endpoint, "POST", { color_hex: target.value });
            const normalizedColor = String(payload.color_hex || target.value);
            target.value = normalizedColor;
            updateSidebarCategoryColor(categoryId, normalizedColor);
            setStatus("Category color updated.");
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to update category color.", true);
        }
    }

    if (addForm) {
        addForm.addEventListener("submit", onAddSubscription);
    }

    if (opmlForm) {
        opmlForm.addEventListener("submit", onImportOpml);
    }

    if (categoryList) {
        categoryList.addEventListener("click", onCategoryButtonClick);
        categoryList.addEventListener("change", onCategoryColorChange);
    }

    // Validate category endpoint wiring once at startup.
    if (categoriesEndpoint === "") {
        setStatus("Category API endpoint is not configured.", true);
    }
})();
