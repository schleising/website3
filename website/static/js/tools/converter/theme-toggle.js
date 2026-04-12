const themeStorageKey = "converter.theme";
const browserThemeColors = {
    light: "#d7edf7",
    dark: "#182230"
};

function applyBrowserThemeColor(theme) {
    const color = browserThemeColors[theme] || browserThemeColors.light;
    const statusBarStyle = theme === "dark" ? "black-translucent" : "default";
    const themeColorMetaElements = document.querySelectorAll('meta[name="theme-color"]');
    const appleStatusBarMetaElement = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

    themeColorMetaElements.forEach(metaElement => {
        metaElement.setAttribute("content", color);
    });

    // Some mobile browsers paint the lower chrome/overscroll area from the root background.
    document.documentElement.style.backgroundColor = color;

    if (appleStatusBarMetaElement != null) {
        appleStatusBarMetaElement.setAttribute("content", statusBarStyle);
    }
}

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

function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-mode", isDark);
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
