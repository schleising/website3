const subscriptionTeamGrid = document.getElementById("subscription-team-grid");
const subscriptionSection = document.querySelector(".football-subscriptions[data-can-manage-subscriptions]");
const subscriptionSelectAll = document.getElementById("subscription-select-all");
const subscriptionSaveButton = document.getElementById("subscription-save");
const subscriptionUnsubscribeButton = document.getElementById("subscription-unsubscribe");
const subscriptionStatus = document.getElementById("subscription-status");
const subscriptionSelectedCount = document.getElementById("subscription-selected-count");
let hasActiveSubscription = false;
const canManageSubscriptions = subscriptionSection?.dataset.canManageSubscriptions === "true";

const serviceWorkerPath = "/sw.js";
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

function setStatus(message, isError = false) {
    if (!subscriptionStatus) {
        return;
    }

    subscriptionStatus.textContent = message;
    subscriptionStatus.classList.toggle("is-error", isError);
}

function setActionButtonsDisabled(disabled) {
    const effectiveDisabled = disabled || !canManageSubscriptions;

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

async function getCurrentSubscription() {
    const registration = await ensureServiceWorkerRegistration();
    return registration.pushManager.getSubscription();
}

async function requestJson(url, method, payload) {
    const response = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
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
        const data = await requestJson("/football/subscription/preferences/", "POST", payload);

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

        updateSelectionCount();
        syncSelectAllState();
        hasActiveSubscription = true;
        setActionButtonsDisabled(false);

        if (canManageSubscriptions) {
            setStatus("Loaded current preferences.");
            return;
        }

        const selectedCount = selectedIds.size;
        const suffix = selectedCount === 1 ? "team" : "teams";
        setStatus(`This browser is subscribed to ${selectedCount} ${suffix}. Login or sign up to manage notifications.`);
    } catch (error) {
        console.error("Failed to load preferences", error);
        resetToUnsubscribedState("Unable to load existing subscription preferences.");
        setStatus("Unable to load existing subscription preferences.", true);
    }
}

async function ensurePushSubscription() {
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
    if (!canManageSubscriptions) {
        setStatus("Login or sign up to manage notifications.", true);
        return;
    }

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

        await requestJson("/football/subscription/preferences/", "PUT", payload);
        hasActiveSubscription = true;
        setStatus("Preferences saved.");
    } catch (error) {
        console.error("Failed to save preferences", error);
        setStatus("Unable to save preferences.", true);
    } finally {
        setActionButtonsDisabled(false);
    }
}

async function unsubscribeAll() {
    if (!canManageSubscriptions) {
        setStatus("Login or sign up to manage notifications.", true);
        return;
    }

    setActionButtonsDisabled(true);
    setStatus("Unsubscribing...");

    try {
        const subscription = await getCurrentSubscription();

        if (!subscription) {
            setStatus("No active push subscription found.");
            return;
        }

        await requestJson("/football/subscription/preferences/", "DELETE", { subscription });
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
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setActionButtonsDisabled(true);
        setStatus("Push notifications are not supported in this browser.", true);
        return;
    }

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

    if (canManageSubscriptions && subscriptionSaveButton) {
        subscriptionSaveButton.addEventListener("click", savePreferences);
    }

    if (canManageSubscriptions && subscriptionUnsubscribeButton) {
        subscriptionUnsubscribeButton.addEventListener("click", unsubscribeAll);
    }

    setActionButtonsDisabled(false);
    updateSelectionCount();
    syncSelectAllState();
    loadPreferences();
});
