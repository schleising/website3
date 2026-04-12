const themeStorageKey = "monitor.theme";
const browserThemeColors = {
    light: "#dff3f2",
    dark: "#182230"
};

function getStoredTheme() {
    try {
        const storedTheme = localStorage.getItem(themeStorageKey);
        if (storedTheme === "dark" || storedTheme === "light") {
            return storedTheme;
        }
    } catch (error) {
        // Ignore storage read errors.
    }

    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
    }

    return "light";
}

function persistTheme(theme) {
    try {
        localStorage.setItem(themeStorageKey, theme);
    } catch (error) {
        // Ignore storage write errors.
    }
}

function applyBrowserThemeColor(theme) {
    const color = browserThemeColors[theme] || browserThemeColors.light;
    const themeColorMetaElements = document.querySelectorAll('meta[name="theme-color"]');

    themeColorMetaElements.forEach(metaElement => {
        metaElement.setAttribute("content", color);
    });

    document.documentElement.style.backgroundColor = color;
}

function applyTheme(theme) {
    const isDark = theme === "dark";

    document.body.classList.toggle("dark-mode", isDark);
    document.body.classList.toggle("light-mode", !isDark);
    document.documentElement.classList.toggle("dark-mode", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";

    applyBrowserThemeColor(theme);

    const themeToggleButton = document.getElementById("theme-toggle-button");
    if (themeToggleButton != null) {
        themeToggleButton.setAttribute("aria-pressed", isDark ? "true" : "false");
        themeToggleButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
        themeToggleButton.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
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
        const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
        applyTheme(nextTheme);
        persistTheme(nextTheme);
    });
}

document.addEventListener("readystatechange", event => {
    if (event.target.readyState === "complete") {
        initializeThemeToggle();
    }
});
