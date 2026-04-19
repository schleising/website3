const subscriptionTeamGrid = document.getElementById("subscription-team-grid");
const subscriptionSection = document.querySelector(".football-subscriptions[data-can-manage-subscriptions]");
const subscriptionSelectAll = document.getElementById("subscription-select-all");
const subscriptionSaveButton = document.getElementById("subscription-save");
const subscriptionUnsubscribeButton = document.getElementById("subscription-unsubscribe");
const subscriptionStatus = document.getElementById("subscription-status");
const subscriptionSelectedCount = document.getElementById("subscription-selected-count");
let hasActiveSubscription = false;
let canManageSubscriptions = subscriptionSection?.dataset.canManageSubscriptions === "true";
const csrfToken = subscriptionSection?.dataset.csrfToken || "";

const footballHtmlElement = document.documentElement;
const footballBasePathRaw = String(footballHtmlElement.dataset.footballBasePath ?? "/football").trim();
const footballBasePath = footballBasePathRaw === "/" ? "" : footballBasePathRaw.replace(/\/+$/, "");
const footballRootPath = footballBasePath === "" ? "/" : `${footballBasePath}/`;
const serviceWorkerPath = `${footballBasePath}/sw.js`;
const serviceWorkerScope = footballRootPath;
const subscriptionPreferencesUrl = `${footballRootPath}subscription/preferences/`;
const vapidPublicKey = "BAE-ATyX2xQGdyv9W5vcsI7qzA1FSui3UYNHgKFSKMmR12_7L9xQcVcDz8JbweMOTWb7npz6VMQMQC1BUylu00E";

function getTeamCheckboxes() {
    if (!subscriptionTeamGrid) {
        return [];
    }

    return Array.from(subscriptionTeamGrid.querySelectorAll(".football-subscription-checkbox"));
}

function getSelectedTeamIds() {
    return getTeamCheckboxes()
        .filter(checkbox => checkbox.checked)
        .map(checkbox => Number(checkbox.value))
        .filter(value => Number.isFinite(value));
}

function updateSelectionCount() {
    if (!subscriptionSelectedCount) {
        return;
    }

    const selectedCount = getSelectedTeamIds().length;
    subscriptionSelectedCount.textContent = `${selectedCount} selected`;
}

function syncSelectAllState() {
    if (!subscriptionSelectAll) {
        return;
    }

    const checkboxes = getTeamCheckboxes();
    const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;

    subscriptionSelectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    subscriptionSelectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function setAllSelections(checked) {
    getTeamCheckboxes().forEach(checkbox => {
        checkbox.checked = checked;
    });

    syncSelectAllState();
    updateSelectionCount();
}

function resetToUnsubscribedState(statusMessage) {
    hasActiveSubscription = false;
    setAllSelections(false);
    setActionButtonsDisabled(false);
    setStatus(statusMessage || defaultUnsubscribedMessage());
}

function defaultUnsubscribedMessage() {
    if (canManageSubscriptions) {
        return "Not currently subscribed. Select teams and save to subscribe.";
    }

    return "This browser is not currently subscribed. Login or sign up to manage notifications.";
}

function statusMessageForOwnership(ownershipStatus, selectedCount) {
    const countSuffix = selectedCount === 1 ? "team" : "teams";

    if (ownershipStatus === "different_user") {
        return `This browser subscription was set up by a different user (${selectedCount} ${countSuffix} selected). Sign in with that account to manage notifications.`;
    }

    return `This browser is subscribed to ${selectedCount} ${countSuffix}. Login or sign up to manage notifications.`;
}

function setStatus(message, isError = false) {
    if (!subscriptionStatus) {
        return;
    }

    subscriptionStatus.textContent = message;
    subscriptionStatus.classList.toggle("is-error", isError);
}

function setActionButtonsDisabled(disabled) {
    const effectiveDisabled = disabled;

    if (subscriptionSaveButton) {
        subscriptionSaveButton.disabled = effectiveDisabled;
    }

    if (subscriptionUnsubscribeButton) {
        subscriptionUnsubscribeButton.disabled = effectiveDisabled || !hasActiveSubscription;
    }

    if (subscriptionSelectAll) {
        subscriptionSelectAll.disabled = effectiveDisabled;
    }

    getTeamCheckboxes().forEach(checkbox => {
        checkbox.disabled = effectiveDisabled;
    });
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

async function ensureServiceWorkerRegistration() {
    const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (registration) {
        await registration.update();
    } else {
        await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
    }

    return navigator.serviceWorker.ready;
}

async function getExistingPushSubscription() {
    const scopedRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
    if (scopedRegistration) {
        const scopedSubscription = await scopedRegistration.pushManager.getSubscription();
        if (scopedSubscription) {
            return scopedSubscription;
        }
    }

    const allRegistrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of allRegistrations) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            return subscription;
        }
    }

    return null;
}

async function getCurrentSubscription() {
    const existingSubscription = await getExistingPushSubscription();
    if (existingSubscription) {
        return existingSubscription;
    }

    try {
        await ensureServiceWorkerRegistration();
        return getExistingPushSubscription();
    } catch (error) {
        console.warn("Failed to ensure football service worker registration before loading preferences", error);
        return null;
    }
}

async function requestJson(url, method, payload) {
    const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let detail = `Request failed with status ${response.status}`;
        try {
            const errorJson = await response.json();
            if (errorJson && typeof errorJson.detail === "string") {
                detail = errorJson.detail;
            }
        } catch (_) {
            // Ignore parse errors and use generic detail.
        }

        throw new Error(detail);
    }

    return response.json();
}

async function loadPreferences() {
    try {
        const subscription = await getCurrentSubscription();

        if (!subscription) {
            resetToUnsubscribedState();
            return;
        }

        const payload = { subscription };
        const data = await requestJson(subscriptionPreferencesUrl, "POST", payload);

        if (!data.is_subscribed) {
            try {
                await subscription.unsubscribe();
            } catch (error) {
                console.warn("Failed to remove stale browser subscription", error);
            }

            resetToUnsubscribedState();
            return;
        }

        if (!Array.isArray(data.team_ids)) {
            setStatus("Subscription loaded, but team preferences were empty.");
            return;
        }

        const selectedIds = new Set(data.team_ids.map(id => Number(id)));
        getTeamCheckboxes().forEach(checkbox => {
            checkbox.checked = selectedIds.has(Number(checkbox.value));
        });

        if (typeof data.can_manage_subscription === "boolean") {
            canManageSubscriptions = data.can_manage_subscription;
        }

        updateSelectionCount();
        syncSelectAllState();
        hasActiveSubscription = true;
        setActionButtonsDisabled(false);

        if (canManageSubscriptions) {
            setStatus("Loaded current preferences.");
            return;
        }

        const selectedCount = selectedIds.size;
        setStatus(statusMessageForOwnership(data.ownership_status, selectedCount), data.ownership_status === "different_user");
    } catch (error) {
        console.error("Failed to load preferences", error);
        const detail = error instanceof Error ? error.message : "Unable to load existing subscription preferences.";
        resetToUnsubscribedState(detail);
        setStatus(detail, true);
    }
}

async function ensurePushSubscription() {
    const existingSubscription = await getExistingPushSubscription();
    if (existingSubscription) {
        return existingSubscription;
    }

    const registration = await ensureServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    return subscription;
}

async function savePreferences() {
    const teamIds = getSelectedTeamIds();
    if (teamIds.length === 0) {
        setStatus("Select at least one team before saving.", true);
        return;
    }

    setActionButtonsDisabled(true);
    setStatus("Saving preferences...");

    try {
        const subscription = await ensurePushSubscription();
        const payload = {
            subscription,
            team_ids: teamIds,
        };

        await requestJson(subscriptionPreferencesUrl, "PUT", payload);
        hasActiveSubscription = true;
        canManageSubscriptions = true;
        setStatus("Preferences saved.");
    } catch (error) {
        console.error("Failed to save preferences", error);
        const detail = error instanceof Error ? error.message : "Unable to save preferences.";
        setStatus(detail, true);
    } finally {
        setActionButtonsDisabled(false);
    }
}

async function unsubscribeAll() {
    setActionButtonsDisabled(true);
    setStatus("Unsubscribing...");

    try {
        const subscription = await getCurrentSubscription();

        if (!subscription) {
            setStatus("No active push subscription found.");
            return;
        }

        await requestJson(subscriptionPreferencesUrl, "DELETE", { subscription });
        await subscription.unsubscribe();
        resetToUnsubscribedState("Not currently subscribed. Select teams and save to subscribe.");
    } catch (error) {
        console.error("Failed to unsubscribe", error);
        setStatus("Unable to unsubscribe right now.", true);
    } finally {
        setActionButtonsDisabled(false);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const supportsServiceWorker = "serviceWorker" in navigator;
    const supportsPushManager = "PushManager" in window;
    const supportsPushNotifications = supportsServiceWorker && supportsPushManager;

    if (subscriptionSelectAll) {
        subscriptionSelectAll.addEventListener("change", event => {
            const target = event.target;
            setAllSelections(Boolean(target && target.checked));
        });
    }

    getTeamCheckboxes().forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            syncSelectAllState();
            updateSelectionCount();
        });
    });

    if (subscriptionSaveButton) {
        subscriptionSaveButton.addEventListener("click", savePreferences);
    }

    if (subscriptionUnsubscribeButton) {
        subscriptionUnsubscribeButton.addEventListener("click", unsubscribeAll);
    }

    if (!supportsPushNotifications) {
        setActionButtonsDisabled(true);
        setStatus("Push notifications are not supported in this browser context.", true);
        console.warn("Football subscriptions disabled: push support unavailable", {
            supportsServiceWorker,
            supportsPushManager,
        });
        return;
    }

    setActionButtonsDisabled(false);
    updateSelectionCount();
    syncSelectAllState();
    loadPreferences();
});
