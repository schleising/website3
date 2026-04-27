document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initialiseStatsQueryState();
    }
});

function initialiseStatsQueryState() {
    const form = document.getElementById("football-stats-form");
    const statsLayout = document.querySelector(".football-stats-layout");
    const queryModal = document.getElementById("football-stats-query-modal");

    if (!form || !statsLayout || !queryModal) {
        return;
    }

    const resetLink = statsLayout.querySelector(".football-stats-reset");
    const submitButton = form.querySelector("button[type='submit']");
    const defaultSubmitLabel = submitButton ? submitButton.textContent : "";

    let isQueryRunning = false;

    const setQueryRunningState = running => {
        isQueryRunning = running;

        statsLayout.classList.toggle("is-query-running", running);
        queryModal.classList.toggle("is-visible", running);
        queryModal.setAttribute("aria-hidden", running ? "false" : "true");
        form.setAttribute("aria-busy", running ? "true" : "false");
        form.setAttribute("aria-disabled", running ? "true" : "false");
        document.body.classList.toggle("football-stats-query-modal-open", running);

        if (submitButton) {
            if (running) {
                submitButton.textContent = "Running...";
                submitButton.setAttribute("aria-disabled", "true");
            } else {
                submitButton.textContent = defaultSubmitLabel;
                submitButton.removeAttribute("aria-disabled");
            }
        }

        if (resetLink) {
            resetLink.classList.toggle("is-disabled", running);
            resetLink.setAttribute("aria-disabled", running ? "true" : "false");
            if (running) {
                resetLink.setAttribute("tabindex", "-1");
            } else {
                resetLink.removeAttribute("tabindex");
            }
        }
    };

    form.addEventListener("submit", event => {
        if (isQueryRunning) {
            event.preventDefault();
            return;
        }

        setQueryRunningState(true);
    });

    if (resetLink) {
        resetLink.addEventListener("click", event => {
            if (!isQueryRunning) {
                return;
            }

            event.preventDefault();
        });
    }

    // When restoring from browser cache (Back/Forward), clear stale running state.
    window.addEventListener("pageshow", () => {
        setQueryRunningState(false);
    });
}
