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
    const subscriptionTableWrap = document.getElementById("feed-subscription-table-wrap");
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
    const subscriptionUpdateTemplate = root.dataset.subscriptionUpdateTemplate || "";
    /** @type {string} */
    const subscriptionDeleteTemplate = root.dataset.subscriptionDeleteTemplate || "";
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
    async function requestJson(url, method, payload = null) {
        const headers = {
            "X-CSRF-Token": csrfToken,
        };

        /** @type {RequestInit} */
        const requestOptions = {
            method,
            headers,
        };

        if (payload !== null) {
            headers["Content-Type"] = "application/json";
            requestOptions.body = JSON.stringify(payload);
        }

        const response = await fetch(url, requestOptions);

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
     * Build endpoint from subscription template and subscription id.
     *
     * @param {string} template
     * @param {string} subscriptionId
     * @returns {string}
     */
    function buildSubscriptionEndpoint(template, subscriptionId) {
        return template.replace("__SUBSCRIPTION_ID__", encodeURIComponent(subscriptionId));
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
     * Resolve a category color from the category settings list.
     *
     * @param {string} categoryId
     * @returns {string}
     */
    function resolveCategoryColor(categoryId) {
        if (categoryId === "") {
            return "#1F6FEB";
        }

        const categoryItem = document.querySelector(`.feed-category-settings-item[data-category-id="${CSS.escape(categoryId)}"]`);
        if (!(categoryItem instanceof HTMLElement)) {
            return "#1F6FEB";
        }

        const colorInput = categoryItem.querySelector(".feed-category-color-input");
        if (colorInput instanceof HTMLInputElement && colorInput.value.trim() !== "") {
            return colorInput.value;
        }

        return "#1F6FEB";
    }

    /**
     * Update all subscription category chips that reference a category.
     *
     * @param {string} categoryId
     * @param {string} colorHex
     */
    function updateSubscriptionCategoryColor(categoryId, colorHex) {
        if (categoryId === "") {
            return;
        }

        const chips = document.querySelectorAll(`.feed-subscription-category-pill[data-category-id="${CSS.escape(categoryId)}"]`);
        chips.forEach(chip => {
            if (chip instanceof HTMLElement) {
                chip.style.setProperty("--feed-category-color", colorHex);
            }
        });
    }

    /**
     * Sync a subscription row's category chip with its selected category.
     *
     * @param {HTMLElement} row
     * @param {string} categoryId
     */
    function syncSubscriptionRowChip(row, categoryId) {
        const chip = row.querySelector(".feed-subscription-category-pill");
        const categorySelect = row.querySelector(".feed-subscription-category-select");
        if (!(chip instanceof HTMLElement) || !(categorySelect instanceof HTMLSelectElement)) {
            return;
        }

        const selectedOption = categorySelect.options[categorySelect.selectedIndex];
        const categoryName = selectedOption ? selectedOption.textContent || "Category" : "Category";
        const categoryColor = resolveCategoryColor(categoryId);

        chip.dataset.categoryId = categoryId;
        chip.textContent = categoryName;
        chip.style.setProperty("--feed-category-color", categoryColor);
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
            updateSubscriptionCategoryColor(categoryId, normalizedColor);
            setStatus("Category color updated.");
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to update category color.", true);
        }
    }

    /**
     * Handle save/delete actions for existing subscriptions.
     *
     * @param {MouseEvent} event
     */
    async function onSubscriptionActionClick(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target) {
            return;
        }

        const row = target.closest(".feed-subscription-row");
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const subscriptionId = String(row.dataset.subscriptionId || "").trim();
        if (subscriptionId === "") {
            return;
        }

        if (target.classList.contains("feed-subscription-save-button")) {
            const urlInput = row.querySelector(".feed-subscription-url-input");
            const categorySelect = row.querySelector(".feed-subscription-category-select");
            if (!(urlInput instanceof HTMLInputElement) || !(categorySelect instanceof HTMLSelectElement)) {
                return;
            }

            const feedUrl = urlInput.value.trim();
            const categoryId = categorySelect.value.trim();
            if (feedUrl === "" || categoryId === "") {
                setStatus("Subscription URL and category are required.", true);
                return;
            }

            setStatus("Saving subscription changes...");

            try {
                const endpoint = buildSubscriptionEndpoint(subscriptionUpdateTemplate, subscriptionId);
                const payload = await requestJson(endpoint, "POST", {
                    feed_url: feedUrl,
                    category_id: categoryId,
                });

                const updatedUrl = String(payload.normalized_url || feedUrl);
                const updatedCategoryId = String(payload.category_id || categoryId);
                const updatedSubscriptionId = String(payload.subscription_id || subscriptionId);
                const updatedSourceTitle = String(payload.source_title || "").trim();

                row.dataset.subscriptionId = updatedSubscriptionId;
                urlInput.value = updatedUrl;
                categorySelect.value = updatedCategoryId;
                if (updatedSourceTitle !== "") {
                    const titleCell = row.querySelector("td");
                    if (titleCell instanceof HTMLElement) {
                        titleCell.textContent = updatedSourceTitle;
                    }
                }
                syncSubscriptionRowChip(row, updatedCategoryId);

                setStatus("Subscription updated.");
            } catch (error) {
                setStatus(error instanceof Error ? error.message : "Unable to update subscription.", true);
            }

            return;
        }

        if (target.classList.contains("feed-subscription-delete-button")) {
            setStatus("Deleting subscription...");

            try {
                const endpoint = buildSubscriptionEndpoint(subscriptionDeleteTemplate, subscriptionId);
                await requestJson(endpoint, "DELETE");
                row.remove();
                setStatus("Subscription deleted.");
            } catch (error) {
                setStatus(error instanceof Error ? error.message : "Unable to delete subscription.", true);
            }
        }
    }

    /**
     * Keep row chip text/color in sync while category selection changes.
     *
     * @param {Event} event
     */
    function onSubscriptionCategorySelectChange(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!(target instanceof HTMLSelectElement) || !target.classList.contains("feed-subscription-category-select")) {
            return;
        }

        const row = target.closest(".feed-subscription-row");
        if (!(row instanceof HTMLElement)) {
            return;
        }

        syncSubscriptionRowChip(row, target.value.trim());
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

    if (subscriptionTableWrap) {
        subscriptionTableWrap.addEventListener("click", onSubscriptionActionClick);
        subscriptionTableWrap.addEventListener("change", onSubscriptionCategorySelectChange);
    }

    // Validate category endpoint wiring once at startup.
    if (categoriesEndpoint === "") {
        setStatus("Category API endpoint is not configured.", true);
    }
})();
