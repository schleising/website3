(function () {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const basePathRaw = document.documentElement.dataset.crypticsBasePath || "";
  const normalizedBasePath = basePathRaw === "/" ? "" : basePathRaw.replace(/\/+$/, "");
  const serviceWorkerPath = `${normalizedBasePath}/sw.js`;
  const serviceWorkerScope = `${normalizedBasePath}/`;

  function promptForRefresh(worker) {
    if (!worker) {
      return;
    }
    const shouldRefresh = window.confirm("A new version of Cryptics is ready. Refresh now?");
    if (!shouldRefresh) {
      return;
    }
    worker.postMessage("SKIP_WAITING");
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register(serviceWorkerPath, { scope: serviceWorkerScope })
      .then(function (registration) {
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptForRefresh(registration.waiting);
        }

        registration.addEventListener("updatefound", function () {
          const installingWorker = registration.installing;
          if (!installingWorker) {
            return;
          }
          installingWorker.addEventListener("statechange", function () {
            if (
              installingWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promptForRefresh(installingWorker);
            }
          });
        });
      })
      .catch(function (error) {
        console.error("Cryptics service worker registration failed", error);
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    });
  });
})();
