const themeStorageKey = "astronomy.theme";
const browserThemeColors = {
    stargazing: "#170909",
    dark: "#0f213a"
};

function getStoredTheme() {
    try {
        const storedTheme = localStorage.getItem(themeStorageKey);
        if (storedTheme === "dark" || storedTheme === "stargazing") {
            return storedTheme;
        }

        // Legacy compatibility for previous light-theme value.
        if (storedTheme === "light") {
            return "stargazing";
        }
    } catch (error) {
        // Ignore storage read errors.
    }

    return "dark";
}

function persistTheme(theme) {
    try {
        localStorage.setItem(themeStorageKey, theme);
    } catch (error) {
        // Ignore storage write errors.
    }
}

function applyBrowserThemeColor(theme) {
    const color = browserThemeColors[theme] || browserThemeColors.stargazing;
    const themeColorMetaElements = document.querySelectorAll('meta[name="theme-color"]');

    themeColorMetaElements.forEach(metaElement => {
        metaElement.setAttribute("content", color);
    });

    document.documentElement.style.backgroundColor = color;
}

function applyTheme(theme) {
    const isDark = theme === "dark";
    const isStargazing = !isDark;

    document.body.classList.toggle("dark-mode", isDark);
    document.body.classList.toggle("stargazing-mode", isStargazing);
    document.documentElement.classList.toggle("dark-mode", isDark);
    document.documentElement.classList.toggle("stargazing-mode", isStargazing);
    document.documentElement.style.colorScheme = "dark";

    applyBrowserThemeColor(theme);
    window.dispatchEvent(new CustomEvent("astronomy-theme-change"));

    const themeToggleButton = document.getElementById("theme-toggle-button");
    if (themeToggleButton != null) {
        themeToggleButton.setAttribute("aria-pressed", isDark ? "true" : "false");
        themeToggleButton.setAttribute("aria-label", isDark ? "Switch to stargazing mode" : "Switch to dark mode");
        themeToggleButton.setAttribute("title", isDark ? "Switch to stargazing mode" : "Switch to dark mode");
    }
}

function initializeThemeToggle() {
    const initialTheme = getStoredTheme();
    applyTheme(initialTheme);

    const themeToggleButton = document.getElementById("theme-toggle-button");
    if (themeToggleButton == null) {
        return;
    }

    themeToggleButton.addEventListener("click", () => {
        const nextTheme = document.body.classList.contains("dark-mode") ? "stargazing" : "dark";
        applyTheme(nextTheme);
        persistTheme(nextTheme);
    });
}

document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initializeThemeToggle();
    }
});
