const notificationsPage = document.querySelector(".system-notifications-page");
const saveButton = document.getElementById("system-notifications-save");
const disableButton = document.getElementById("system-notifications-disable");
const statusElement = document.getElementById("system-notifications-status");
const csrfToken = notificationsPage?.dataset.csrfToken || "";

const serviceWorkerPath = "/sw.js?v=system-notifications-v1";
const serviceWorkerScope = "/";
const subscriptionsUrl = "/account/notifications/subscriptions/";
const currentPreferencesUrl = "/account/notifications/subscriptions/current/";
const vapidPublicKey =
    "BAE-ATyX2xQGdyv9W5vcsI7qzA1FSui3UYNHgKFSKMmR12_7L9xQcVcDz8JbweMOTWb7npz6VMQMQC1BUylu00E";
const subscriptionClientStorageKey = "system.subscriptionClientId.v1";
const browserSubscriptionClientId = getBrowserSubscriptionClientId();

let hasActiveSubscription = false;

function createSubscriptionClientId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getBrowserSubscriptionClientId() {
    try {
        const existing = window.localStorage.getItem(subscriptionClientStorageKey);
        if (typeof existing === "string" && existing.trim() !== "") {
            return existing.trim();
        }

        const created = createSubscriptionClientId();
        window.localStorage.setItem(subscriptionClientStorageKey, created);
        return created;
    } catch (_) {
        return createSubscriptionClientId();
    }
}

function getTopicCheckboxes() {
    return Array.from(
        document.querySelectorAll(".system-notifications-topic-checkbox")
    );
}

function getSelectedTopics() {
    return getTopicCheckboxes()
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
}

function setSelectedTopics(topics) {
    const selected = new Set(topics || []);
    getTopicCheckboxes().forEach((checkbox) => {
        checkbox.checked = selected.has(checkbox.value);
    });
}

function setStatus(message, { isError = false, isSuccess = false } = {}) {
    if (!statusElement) {
        return;
    }

    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
    statusElement.classList.toggle("is-success", isSuccess);
}

function setControlsEnabled(enabled) {
    getTopicCheckboxes().forEach((checkbox) => {
        checkbox.disabled = !enabled;
    });

    if (saveButton) {
        saveButton.disabled = !enabled;
    }

    if (disableButton) {
        disableButton.disabled = !enabled || !hasActiveSubscription;
        disableButton.hidden = !hasActiveSubscription;
    }
}

function updateActionLabels() {
    if (!saveButton) {
        return;
    }

    saveButton.textContent = hasActiveSubscription
        ? "Update preferences"
        : "Enable notifications";
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

function buildSubscriptionPayload(subscription) {
    const payload = {};
    if (subscription) {
        payload.subscription = subscription;
    }
    if (browserSubscriptionClientId) {
        payload.client_id = browserSubscriptionClientId;
    }
    return payload;
}

async function ensureServiceWorkerRegistration() {
    const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

    if (registration) {
        await registration.update();
    } else {
        await navigator.serviceWorker.register(serviceWorkerPath, {
            scope: serviceWorkerScope,
            updateViaCache: "none",
        });
    }

    return navigator.serviceWorker.ready;
}

async function getExistingPushSubscription() {
    const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
    if (!registration) {
        return null;
    }

    return registration.pushManager.getSubscription();
}

async function ensurePushSubscription() {
    const registration = await ensureServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (subscription == null) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    return subscription;
}

async function requestJson(url, method, payload) {
    const requestOptions = {
        method,
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
        },
    };

    if (payload !== undefined) {
        requestOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, requestOptions);

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

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

async function loadPreferences({ supportsPushNotifications }) {
    try {
        const query = browserSubscriptionClientId
            ? `?client_id=${encodeURIComponent(browserSubscriptionClientId)}`
            : "";
        const preferences = await requestJson(
            `${currentPreferencesUrl}${query}`,
            "GET"
        );

        hasActiveSubscription = Boolean(preferences?.is_subscribed);
        if (Array.isArray(preferences?.topics) && preferences.topics.length > 0) {
            setSelectedTopics(preferences.topics);
        }

        if (!supportsPushNotifications) {
            setStatus("Push messaging is not supported in this browser.", {
                isError: true,
            });
            setControlsEnabled(false);
            updateActionLabels();
            return;
        }

        updateActionLabels();
        setControlsEnabled(true);
        setStatus(
            hasActiveSubscription
                ? "This browser is subscribed. Adjust topics and save to update."
                : "Select topics and enable notifications for this browser."
        );
    } catch (error) {
        console.error("Failed to load system notification preferences", error);
        setStatus(error instanceof Error ? error.message : "Failed to load preferences.", {
            isError: true,
        });
        setControlsEnabled(false);
    }
}

async function savePreferences() {
    const topics = getSelectedTopics();
    if (topics.length === 0) {
        setStatus("Select at least one notification topic.", { isError: true });
        return;
    }

    setControlsEnabled(false);
    setStatus(hasActiveSubscription ? "Updating preferences…" : "Enabling notifications…");

    try {
        const subscription = await ensurePushSubscription();
        const payload = {
            ...buildSubscriptionPayload(subscription),
            topics,
        };
        const result = await requestJson(subscriptionsUrl, "PUT", payload);
        hasActiveSubscription = true;
        if (Array.isArray(result?.topics)) {
            setSelectedTopics(result.topics);
        }
        updateActionLabels();
        setControlsEnabled(true);
        setStatus(result?.message || "Notification preferences saved.", {
            isSuccess: true,
        });
    } catch (error) {
        console.error("Failed to save system notification preferences", error);
        setStatus(error instanceof Error ? error.message : "Failed to save preferences.", {
            isError: true,
        });
        setControlsEnabled(true);
    }
}

async function disableNotifications() {
    setControlsEnabled(false);
    setStatus("Disabling notifications…");

    try {
        const subscription = await getExistingPushSubscription();
        await requestJson(
            subscriptionsUrl,
            "DELETE",
            buildSubscriptionPayload(subscription)
        );

        if (subscription) {
            await subscription.unsubscribe();
        }

        hasActiveSubscription = false;
        updateActionLabels();
        setControlsEnabled(true);
        setStatus("Notifications disabled for this browser.", { isSuccess: true });
    } catch (error) {
        console.error("Failed to disable system notifications", error);
        setStatus(
            error instanceof Error ? error.message : "Failed to disable notifications.",
            { isError: true }
        );
        setControlsEnabled(true);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (!notificationsPage || !saveButton || !disableButton) {
        return;
    }

    saveButton.addEventListener("click", () => {
        void savePreferences();
    });
    disableButton.addEventListener("click", () => {
        void disableNotifications();
    });

    const supportsPushNotifications =
        "serviceWorker" in navigator && "PushManager" in window;

    if (supportsPushNotifications) {
        ensureServiceWorkerRegistration()
            .catch((error) => {
                console.warn("Service worker registration failed", error);
            })
            .finally(() => {
                void loadPreferences({ supportsPushNotifications: true });
            });
    } else {
        void loadPreferences({ supportsPushNotifications: false });
    }
});
