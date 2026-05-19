function decodeHtml(input) {
    const doc = new DOMParser().parseFromString(input, "text/html");
    return doc.documentElement.textContent;
}

function buildSvg(svgGraph) {
    const template = document.createElement("template");
    template.innerHTML = svgGraph;
    return template.content.firstChild;
}

async function renderMermaidIntoElement(element, definition, id) {
    if (!definition || definition.trim() === "") {
        return;
    }

    try {
        const { svg, bindFunctions } = await mermaid.render(id, definition);
        const svgElement = buildSvg(svg);
        if (svgElement == null) {
            return;
        }

        element.replaceChildren(svgElement);
        bindFunctions?.(element);
        element.classList.add("is-rendered");
    } catch (error) {
        // Leave the preview empty if Mermaid cannot parse the definition.
    }
}

async function initialiseBlogMermaid() {
    if (typeof mermaid === "undefined") {
        return;
    }

    mermaid.initialize({ startOnLoad: false });

    const blogElements = Array.from(document.querySelectorAll("#blog-view .mermaid-source"));
    if (blogElements.length > 0) {
        for (const [index, element] of blogElements.entries()) {
            element.classList.add("mermaid");
            if (element.id === "") {
                element.id = `blog-mermaid-${index}`;
            }
        }

        try {
            await mermaid.run({
                nodes: blogElements,
                suppressErrors: true,
            });

            blogElements.forEach(element => {
                element.classList.add("is-rendered");
            });
        } catch (error) {
            // Leave the source text visible if Mermaid cannot parse the definition.
        }
    }

    const previewElements = Array.from(document.querySelectorAll(".blog-card-mermaid[data-mermaid-definition]"));
    for (const [index, element] of previewElements.entries()) {
        const definition = element.dataset.mermaidDefinition ?? "";
        await renderMermaidIntoElement(element, definition, `blog-card-mermaid-${index}`);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseBlogMermaid);
} else {
    initialiseBlogMermaid();
}
