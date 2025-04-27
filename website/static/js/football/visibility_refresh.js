document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        // Refresh the page when the tab becomes visible
        window.location.reload();
    }
});
