const COMPETITION_PANEL_TRANSITION_MS = 240;

document.addEventListener("readystatechange", event => {
    if (event.target.readyState !== "complete") {
        return;
    }

    document.querySelectorAll(".football-competition-details").forEach(initialiseCompetitionDetails);
});

function initialiseCompetitionDetails(details) {
    const summary = details.querySelector(".football-competition-summary");
    const panel = details.querySelector(".football-competition-links");

    if (!summary || !panel) {
        return;
    }

    if (details.open) {
        details.classList.add("is-expanded");
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    summary.addEventListener("click", event => {
        event.preventDefault();

        if (details.classList.contains("is-animating")) {
            return;
        }

        if (details.classList.contains("is-expanded")) {
            collapseCompetitionDetails(details, panel, summary);
        } else {
            expandCompetitionDetails(details, panel, summary);
        }
    });
}

function expandCompetitionDetails(details, panel, summary) {
    details.classList.add("is-animating");
    details.classList.remove("is-expanded");
    details.open = true;
    summary.setAttribute("aria-expanded", "true");

    clearPanelAnimationStyles(panel);
    panel.style.height = "0px";
    panel.style.overflow = "hidden";

    const targetHeight = measureCompetitionPanelHeight(panel);

    requestAnimationFrame(() => {
        panel.style.transition = `height ${COMPETITION_PANEL_TRANSITION_MS}ms ease`;
        details.classList.add("is-expanded");
        panel.style.height = `${targetHeight}px`;
    });

    finishCompetitionPanelAnimation(details, panel, () => {
        clearPanelAnimationStyles(panel);
        details.classList.remove("is-animating");
    });
}

function collapseCompetitionDetails(details, panel, summary) {
    details.classList.add("is-animating");
    summary.setAttribute("aria-expanded", "false");

    const startHeight = measureCompetitionPanelHeight(panel);
    clearPanelAnimationStyles(panel);
    details.classList.remove("is-expanded");
    panel.style.height = `${startHeight}px`;
    panel.style.overflow = "hidden";

    requestAnimationFrame(() => {
        panel.style.transition = `height ${COMPETITION_PANEL_TRANSITION_MS}ms ease`;
        panel.style.height = "0px";
    });

    finishCompetitionPanelAnimation(details, panel, () => {
        details.open = false;
        clearPanelAnimationStyles(panel);
        details.classList.remove("is-animating");
    });
}

function measureCompetitionPanelHeight(panel) {
    const inner = panel.querySelector(".football-competition-links-inner");
    if (inner) {
        return inner.scrollHeight;
    }

    return panel.scrollHeight;
}

function clearPanelAnimationStyles(panel) {
    panel.style.height = "";
    panel.style.overflow = "";
    panel.style.transition = "";
}

function finishCompetitionPanelAnimation(details, panel, onComplete) {
    let completed = false;

    const complete = () => {
        if (completed) {
            return;
        }

        completed = true;
        panel.removeEventListener("transitionend", handleTransitionEnd);
        onComplete();
    };

    const handleTransitionEnd = event => {
        if (event.target !== panel || event.propertyName !== "height") {
            return;
        }

        complete();
    };

    panel.addEventListener("transitionend", handleTransitionEnd);
    window.setTimeout(complete, COMPETITION_PANEL_TRANSITION_MS + 50);
}
