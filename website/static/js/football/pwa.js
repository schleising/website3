(function () {
    "use strict";

    if (!("serviceWorker" in navigator)) {
        return;
    }

    const htmlElement = document.documentElement;
    const footballBasePathRaw = String(htmlElement.dataset.footballBasePath || "/football").trim();
    const footballBasePath = footballBasePathRaw === "/" ? "" : footballBasePathRaw.replace(/\/+$/, "");
    const serviceWorkerPath = `${footballBasePath}/sw.js`;
    const serviceWorkerScope = footballBasePath === "" ? "/" : `${footballBasePath}/`;

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
            console.error("Football service worker registration failed", error);
        });
    });
})();
