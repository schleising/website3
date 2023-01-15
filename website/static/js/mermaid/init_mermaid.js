function initializeMermaid() {
    mermaid.initialize({startOnLoad:true})
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(initializeMermaid, 1);
} else {
    document.addEventListener("DOMContentLoaded", initializeMermaid);
}
