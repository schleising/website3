var nav = document.getElementById("blog-list-nav");
var childArray = Array.from(nav.children);

childArray.forEach(element => {
    element.addEventListener("click", event => {
        blogLinkClicked('/blog/blog_id/', element.id, populateBlogArea);
    });
});

function populateBlogArea(jsn) {
    data = JSON.parse(jsn)

    document.getElementById("blog-title").innerHTML = data.title;
    document.getElementById("blog-author").innerHTML = "Author: " + data.first_name + " " + data.last_name;
    document.getElementById("blog-view").innerHTML = data.text;

    // Get any divs whose class is mermaid
    mermaidElements = document.getElementsByClassName("mermaid");

    // Loop through the mermaid divs
    for (let index = 0; index < mermaidElements.length; index++) {
        // Get the ID
        id = mermaidElements[index].id;

        // Get the markdown for the image
        innerHTML = htmlDecode(mermaidElements[index].innerHTML);

        try {
            // Render the image, append -svg to the ID so it doesn't trash the existing div
            mermaid.mermaidAPI.render(id + "-svg", innerHTML, mermaidCallback);
        } catch (e) {
            // Ignore the parsing error as this will happen while building up the diagram
        }
    }
};

function mermaidCallback(svgGraph) {
    // Create a template to hold the svg
    template = document.createElement("template");

    // Add the svg to the template
    template.innerHTML = svgGraph;

    // Get the svg, which is now an element, from the template
    newElement = template.content.firstChild;

    // Get the div element to insert the svg into, the ID is found by stripping the -svg from the svg ID
    mermaidElement = document.getElementById(newElement.id.substring(0, newElement.id.length - 4))

    // Clear the existing children from the mermaid div
    mermaidElement.replaceChildren();

    // Append the svg element as a child of the svg div
    mermaidElement.appendChild(newElement);
}

const htmlDecode = (input) => {
    const doc = new DOMParser().parseFromString(input, "text/html");
    return doc.documentElement.textContent;
}
  