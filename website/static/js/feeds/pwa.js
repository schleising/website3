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

    async function ensureServiceWorkerRegistration() {
        const existingRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);

        if (existingRegistration) {
            await existingRegistration.update();
            return;
        }

        await navigator.serviceWorker.register(serviceWorkerPath, { scope: serviceWorkerScope });
    }

    window.addEventListener("load", function () {
        ensureServiceWorkerRegistration().catch(function (error) {
            console.error("Feeds service worker registration failed", error);
        });
    });
})();
