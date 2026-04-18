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
    /** @type {HTMLElement | null} */
    const subscriptionEditPopup = document.getElementById("feed-subscription-edit-popup");
    /** @type {HTMLElement | null} */
    const subscriptionEditBackdrop = document.getElementById("feed-subscription-edit-backdrop");
    /** @type {HTMLFormElement | null} */
    const subscriptionEditForm = document.getElementById("feed-subscription-edit-form");
    /** @type {HTMLInputElement | null} */
    const subscriptionEditIdInput = document.getElementById("feed-subscription-edit-id");
    /** @type {HTMLInputElement | null} */
    const subscriptionEditUrlInput = document.getElementById("feed-subscription-edit-url");
    /** @type {HTMLSelectElement | null} */
    const subscriptionEditCategorySelect = document.getElementById("feed-subscription-edit-category");
    /** @type {HTMLButtonElement | null} */
    const subscriptionEditCloseButton = document.getElementById("feed-subscription-edit-close");
    /** @type {HTMLButtonElement | null} */
    const subscriptionEditCancelButton = document.getElementById("feed-subscription-edit-cancel");

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

    /** @type {HTMLElement | null} */
    let activeSubscriptionRow = null;
    /** @type {HTMLButtonElement | null} */
    let subscriptionEditTriggerButton = null;

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
     * Update right-sidebar category count labels.
     *
     * @param {{ all_unread_count?: number, categories?: Array<Record<string, any>> }} payload
     */
    function updateSidebarCounts(payload) {
        const allLink = document.querySelector('.feed-category-shortcut[data-category-shortcut="all"]');
        if (allLink) {
            const allCountNode = allLink.querySelector(".feed-category-count");
            if (allCountNode) {
                allCountNode.textContent = String(Number(payload.all_unread_count || 0));
            }
        }

        const categories = Array.isArray(payload.categories) ? payload.categories : [];
        categories.forEach(category => {
            const categoryId = String(category.category_id || "");
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
     * Refresh right-sidebar counts and category state.
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
            // Ignore sidebar refresh failures to avoid blocking settings interactions.
        }
    }

    /**
     * Update right-sidebar category unread pill color without reloading.
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

        const countPill = link.querySelector(".feed-category-count");
        if (countPill instanceof HTMLElement) {
            countPill.style.setProperty("--feed-category-accent", colorHex);
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
     * Sync a subscription row URL link from an edited/new URL value.
     *
     * @param {HTMLElement} row
     * @param {string} feedUrl
     */
    function syncSubscriptionRowUrlLink(row, feedUrl) {
        const urlLink = row.querySelector(".feed-subscription-url-link");
        if (!(urlLink instanceof HTMLAnchorElement)) {
            return;
        }

        const normalizedUrl = feedUrl.trim();
        if (normalizedUrl === "") {
            return;
        }

        urlLink.href = normalizedUrl;
        urlLink.textContent = normalizedUrl;
    }

    /**
     * Toggle subscription edit popup visibility.
     *
     * @param {boolean} isOpen
     */
    function setSubscriptionEditPopupVisibility(isOpen) {
        if (!(subscriptionEditPopup instanceof HTMLElement) || !(subscriptionEditBackdrop instanceof HTMLElement)) {
            return;
        }

        subscriptionEditPopup.classList.toggle("hidden", !isOpen);
        subscriptionEditBackdrop.classList.toggle("hidden", !isOpen);
        subscriptionEditBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
        document.body.classList.toggle("feed-subscription-popup-open", isOpen);
    }

    /**
     * Close subscription edit popup and restore focus to the triggering button.
     */
    function closeSubscriptionEditPopup() {
        setSubscriptionEditPopupVisibility(false);

        if (subscriptionEditTriggerButton instanceof HTMLButtonElement) {
            subscriptionEditTriggerButton.setAttribute("aria-expanded", "false");
            subscriptionEditTriggerButton.focus();
        }

        activeSubscriptionRow = null;
        subscriptionEditTriggerButton = null;
    }

    /**
     * Open subscription edit popup prefilled from the selected row.
     *
     * @param {HTMLElement} row
     * @param {HTMLButtonElement} triggerButton
     */
    function openSubscriptionEditPopup(row, triggerButton) {
        if (
            !(subscriptionEditPopup instanceof HTMLElement)
            || !(subscriptionEditIdInput instanceof HTMLInputElement)
            || !(subscriptionEditUrlInput instanceof HTMLInputElement)
            || !(subscriptionEditCategorySelect instanceof HTMLSelectElement)
        ) {
            setStatus("Subscription edit popup is not available.", true);
            return;
        }

        const subscriptionId = String(row.dataset.subscriptionId || "").trim();
        const rowUrlInput = row.querySelector(".feed-subscription-url-input");
        const rowCategorySelect = row.querySelector(".feed-subscription-category-select");
        if (!(rowUrlInput instanceof HTMLInputElement) || !(rowCategorySelect instanceof HTMLSelectElement) || subscriptionId === "") {
            setStatus("Unable to edit this subscription.", true);
            return;
        }

        const titleNode = document.getElementById("feed-subscription-edit-title");
        const rowTitleCell = row.querySelector(".feed-subscription-title-cell");
        const sourceTitle = rowTitleCell instanceof HTMLElement
            ? String(rowTitleCell.textContent || "").trim()
            : "";

        if (titleNode instanceof HTMLElement) {
            titleNode.textContent = sourceTitle !== "" ? `Edit Subscription: ${sourceTitle}` : "Edit Subscription";
        }

        subscriptionEditIdInput.value = subscriptionId;
        subscriptionEditUrlInput.value = rowUrlInput.value.trim();
        subscriptionEditCategorySelect.value = rowCategorySelect.value.trim();
        subscriptionEditCategorySelect.dispatchEvent(new Event("change", { bubbles: true }));

        activeSubscriptionRow = row;
        subscriptionEditTriggerButton = triggerButton;
        subscriptionEditTriggerButton.setAttribute("aria-expanded", "true");

        setSubscriptionEditPopupVisibility(true);
        subscriptionEditUrlInput.focus();
        subscriptionEditUrlInput.select();
    }

    /**
     * Save edits from the subscription popup.
     *
     * @param {SubmitEvent} event
     */
    async function onSubscriptionEditSubmit(event) {
        event.preventDefault();

        if (
            !(activeSubscriptionRow instanceof HTMLElement)
            || !(subscriptionEditIdInput instanceof HTMLInputElement)
            || !(subscriptionEditUrlInput instanceof HTMLInputElement)
            || !(subscriptionEditCategorySelect instanceof HTMLSelectElement)
        ) {
            return;
        }

        const subscriptionId = subscriptionEditIdInput.value.trim();
        const feedUrl = subscriptionEditUrlInput.value.trim();
        const categoryId = subscriptionEditCategorySelect.value.trim();

        if (subscriptionId === "" || feedUrl === "" || categoryId === "") {
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

            const updatedUrl = String(payload.normalized_url || feedUrl).trim();
            const updatedCategoryId = String(payload.category_id || categoryId).trim();
            const updatedSubscriptionId = String(payload.subscription_id || subscriptionId).trim();
            const updatedSourceTitle = String(payload.source_title || "").trim();

            const row = activeSubscriptionRow;
            row.dataset.subscriptionId = updatedSubscriptionId;

            const rowUrlInput = row.querySelector(".feed-subscription-url-input");
            if (rowUrlInput instanceof HTMLInputElement) {
                rowUrlInput.value = updatedUrl;
            }

            const rowCategorySelect = row.querySelector(".feed-subscription-category-select");
            if (rowCategorySelect instanceof HTMLSelectElement) {
                rowCategorySelect.value = updatedCategoryId;
            }

            syncSubscriptionRowUrlLink(row, updatedUrl);
            syncSubscriptionRowChip(row, updatedCategoryId);

            if (updatedSourceTitle !== "") {
                const rowTitleCell = row.querySelector(".feed-subscription-title-cell");
                if (rowTitleCell instanceof HTMLElement) {
                    rowTitleCell.textContent = updatedSourceTitle;
                }

                const editButton = row.querySelector(".feed-subscription-edit-button");
                if (editButton instanceof HTMLButtonElement) {
                    editButton.setAttribute("aria-label", `Edit subscription ${updatedSourceTitle}`);
                }

                const deleteButton = row.querySelector(".feed-subscription-delete-button");
                if (deleteButton instanceof HTMLButtonElement) {
                    deleteButton.setAttribute("aria-label", `Delete subscription ${updatedSourceTitle}`);
                }
            }

            closeSubscriptionEditPopup();
            setStatus("Subscription updated.");
            await refreshSidebarCounts();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to update subscription.", true);
        }
    }

    /**
     * Initialize subscription rows in read-only mode with synchronized chips and links.
     */
    function initializeSubscriptionRows() {
        const rows = document.querySelectorAll(".feed-subscription-row");
        rows.forEach(row => {
            if (!(row instanceof HTMLElement)) {
                return;
            }

            const urlInput = row.querySelector(".feed-subscription-url-input");
            if (urlInput instanceof HTMLInputElement) {
                syncSubscriptionRowUrlLink(row, urlInput.value);
            }

            const categorySelect = row.querySelector(".feed-subscription-category-select");
            if (categorySelect instanceof HTMLSelectElement) {
                syncSubscriptionRowChip(row, categorySelect.value.trim());
            }
        });
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
        if (!target) {
            return;
        }

        const actionButton = target.closest(".feed-category-mute-button");
        if (!(actionButton instanceof HTMLButtonElement)) {
            return;
        }

        const item = actionButton.closest(".feed-category-settings-item");
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const categoryId = item.dataset.categoryId || "";
        if (categoryId === "") {
            return;
        }

        const categoryNameNode = item.querySelector(".feed-category-settings-name");
        const categoryName = categoryNameNode instanceof HTMLElement
            ? String(categoryNameNode.textContent || "").trim()
            : "";

        const currentlyMuted = actionButton.dataset.muted === "true";
        const endpoint = currentlyMuted
            ? categoryEndpoint(categoryUnmuteTemplate, categoryId)
            : categoryEndpoint(categoryMuteTemplate, categoryId);

        setStatus(currentlyMuted ? "Unmuting category..." : "Muting category...");

        try {
            const payload = await requestJson(endpoint, "POST", {});
            const nowMuted = Boolean(payload.muted);
            actionButton.dataset.muted = nowMuted ? "true" : "false";
            actionButton.classList.toggle("is-muted", nowMuted);
            const nextLabel = `${nowMuted ? "Unmute" : "Mute"} category${categoryName !== "" ? ` ${categoryName}` : ""}`;
            actionButton.setAttribute("aria-label", nextLabel);
            actionButton.title = nextLabel;
            setStatus(nowMuted ? "Category muted." : "Category unmuted.");
            await refreshSidebarCounts();
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
            await refreshSidebarCounts();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to update category color.", true);
        }
    }

    /**
     * Handle edit/delete actions for existing subscriptions.
     *
     * @param {MouseEvent} event
     */
    async function onSubscriptionActionClick(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target) {
            return;
        }

        const actionButton = target.closest("button");
        if (!(actionButton instanceof HTMLButtonElement)) {
            return;
        }

        const row = actionButton.closest(".feed-subscription-row");
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const subscriptionId = String(row.dataset.subscriptionId || "").trim();
        if (subscriptionId === "") {
            return;
        }

        if (actionButton.classList.contains("feed-subscription-edit-button")) {
            openSubscriptionEditPopup(row, actionButton);
            setStatus("Editing subscription.");
            return;
        }

        if (actionButton.classList.contains("feed-subscription-delete-button")) {
            setStatus("Deleting subscription...");

            try {
                const endpoint = buildSubscriptionEndpoint(subscriptionDeleteTemplate, subscriptionId);
                await requestJson(endpoint, "DELETE");

                if (activeSubscriptionRow === row) {
                    closeSubscriptionEditPopup();
                }

                row.remove();
                setStatus("Subscription deleted.");
                await refreshSidebarCounts();
            } catch (error) {
                setStatus(error instanceof Error ? error.message : "Unable to delete subscription.", true);
            }
        }
    }

    /**
     * Initialize popup interactions for editing subscriptions.
     */
    function initializeSubscriptionEditPopup() {
        if (!(subscriptionEditPopup instanceof HTMLElement) || !(subscriptionEditBackdrop instanceof HTMLElement)) {
            return;
        }

        // Keep popup layers above any scrolling/card overflow contexts.
        if (subscriptionEditPopup.parentElement !== document.body) {
            document.body.appendChild(subscriptionEditPopup);
        }

        if (subscriptionEditBackdrop.parentElement !== document.body) {
            document.body.appendChild(subscriptionEditBackdrop);
        }

        if (subscriptionEditForm instanceof HTMLFormElement) {
            subscriptionEditForm.addEventListener("submit", onSubscriptionEditSubmit);
        }

        if (subscriptionEditCloseButton instanceof HTMLButtonElement) {
            subscriptionEditCloseButton.addEventListener("click", closeSubscriptionEditPopup);
        }

        if (subscriptionEditCancelButton instanceof HTMLButtonElement) {
            subscriptionEditCancelButton.addEventListener("click", closeSubscriptionEditPopup);
        }

        subscriptionEditBackdrop.addEventListener("click", closeSubscriptionEditPopup);

        document.addEventListener("keydown", event => {
            if (event.key !== "Escape" || subscriptionEditPopup.classList.contains("hidden")) {
                return;
            }

            closeSubscriptionEditPopup();
        });
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
        initializeSubscriptionRows();
    }

    initializeSubscriptionEditPopup();

    // Validate category endpoint wiring once at startup.
    if (categoriesEndpoint === "") {
        setStatus("Category API endpoint is not configured.", true);
    } else {
        refreshSidebarCounts();
        window.setInterval(refreshSidebarCounts, 2000);
    }
})();
