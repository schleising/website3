(function () {
    "use strict";

    if (!("serviceWorker" in navigator)) {
        return;
    }

    const htmlElement = document.documentElement;
    const basePathRaw = String(htmlElement.dataset.feedsBasePath || "").trim();
    const normalizedBasePath = basePathRaw === "/" ? "" : basePathRaw.replace(/\/+$/, "");
    const serviceWorkerPath = `${normalizedBasePath}/sw.js`;
    const serviceWorkerScope = `${normalizedBasePath}/`;
    let isReloadingForUpdate = false;

    function promptForWaitingWorker(registration) {
        if (!registration || !registration.waiting) {
            return;
        }

        if (window.__pwaUpdatePromptOpen === true) {
            return;
        }

        window.__pwaUpdatePromptOpen = true;
        const shouldUpdateNow = window.confirm("A new version is available. Update now?");
        if (shouldUpdateNow) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
        } else {
            window.__pwaUpdatePromptOpen = false;
        }
    }

    function attachUpdateFlow(registration) {
        if (!registration) {
            return;
        }

        promptForWaitingWorker(registration);

        registration.addEventListener("updatefound", function () {
            const installingWorker = registration.installing;
            if (!installingWorker) {
                return;
            }

            installingWorker.addEventListener("statechange", function () {
                if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                    promptForWaitingWorker(registration);
                }
            });
        });

        navigator.serviceWorker.addEventListener("controllerchange", function () {
            if (isReloadingForUpdate) {
                return;
            }

            isReloadingForUpdate = true;
            window.location.reload();
        });
    }

    async function ensureServiceWorkerRegistration() {
        const existingRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

        if (existingRegistration) {
            await existingRegistration.update();
            attachUpdateFlow(existingRegistration);
            return;
        }

        const registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
        attachUpdateFlow(registration);
    }

    window.addEventListener("load", function () {
        ensureServiceWorkerRegistration().catch(function (error) {
            console.error("Feeds service worker registration failed", error);
        });
    });
})();
