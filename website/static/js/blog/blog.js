function decodeHtml(input) {
    const doc = new DOMParser().parseFromString(input, "text/html");
    return doc.documentElement.textContent;
}

function buildSvg(svgGraph) {
    const template = document.createElement("template");
    template.innerHTML = svgGraph;
    return template.content.firstChild;
}

function renderMermaidIntoElement(element, definition, id) {
    if (!definition || definition.trim() === "") {
        return;
    }

    try {
        mermaid.mermaidAPI.render(id, definition, svgGraph => {
            const svgElement = buildSvg(svgGraph);
            if (svgElement == null) {
                return;
            }

            element.replaceChildren(svgElement);
            element.classList.add("is-rendered");
        });
    } catch (error) {
        // Leave the preview empty if Mermaid cannot parse the definition.
    }
}

function initialiseBlogMermaid() {
    if (typeof mermaid === "undefined") {
        return;
    }

    mermaid.mermaidAPI.initialize({ startOnLoad: false });

    document.querySelectorAll("#blog-view .mermaid").forEach((element, index) => {
        const definition = decodeHtml(element.innerHTML).trim();
        renderMermaidIntoElement(element, definition, `blog-mermaid-${index}`);
    });

    document.querySelectorAll(".blog-card-mermaid[data-mermaid-definition]").forEach((element, index) => {
        const definition = element.dataset.mermaidDefinition ?? "";
        renderMermaidIntoElement(element, definition, `blog-card-mermaid-${index}`);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseBlogMermaid);
} else {
    initialiseBlogMermaid();
}
