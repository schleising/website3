// Message types
let MARKDOWN_UPDATE = 1
let GET_BLOG_LIST = 2
let GET_BLOG_TEXT = 3

// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable for the Data Saved toast
var saveToast;

let loadButton = document.getElementById("load-button");
let saveButton = document.getElementById("save-button");
let clearButton = document.getElementById("clear-button");
let titleInput = document.getElementById("title-input");
let textArea = document.getElementById("markdown-editor-textarea");
let markdownOutput = document.getElementById("markdown-output");

loadButton.addEventListener("click", event => {
    // Eanable / Disable buttons
    saveButton.disabled = !saveButton.disabled;
    clearButton.disabled = !clearButton.disabled;
    titleInput.disabled = !titleInput.disabled;
    textArea.disabled = !textArea.disabled;

    // Set the text for the Load / Cancel button
    if (loadButton.innerHTML === "Load") {
        loadButton.innerHTML = "Cancel";
    } else {
        loadButton.innerHTML = "Load";
    }

    if (textArea.disabled) {
        // If we are loading data, clear the markdown and request the list of posts to edit
        markdownOutput.replaceChildren();

        // Get the blog list
        checkSocketAndSendMessage(event, GET_BLOG_LIST);
    } else {
        // Reload the markdown
        updateMarkdownText(event);
    }
});

// Disable the text entry box while the page loads
textArea.disabled = true;

// Add a callback for key up in the title
titleInput.addEventListener("keyup", event => {
    // Save the title text
    if (storageAvailable("sessionStorage")) {
        sessionStorage.setItem("title", titleInput.value);
    }
});

// Add a callback for key up in the textarea
textArea.addEventListener("keyup", event => updateMarkdownText(event));

// Add button event listener to clear text
clearButton.addEventListener('click', event => {
    // Clear the text from the title
    titleInput.value = "";

    // Clear the test from the textarea, the session storage is cleared by updateMarkdownText
    textArea.value = "";

    // Send the updated data to the server
    updateMarkdownText(event);
});

// On save being clicked send a Save Message
saveButton.addEventListener("click", event => checkSocketAndSendMessage(event, MARKDOWN_UPDATE));

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

function updateMarkdown(data) {
    // Add the formatted text to the control
    markdownOutput.innerHTML = data.markdown_text;

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

    // If the data has been saved to the db indicate this to the user
    if (data.data_saved != null) {
        if (data.data_saved == true) {
            document.getElementById("toast-body").innerHTML = "Data Saved OK";
        } else {
            document.getElementById("toast-body").innerHTML = "Data NOT Saved";
        }
        saveToast.show();
    }
};

function updateBlogList(data) {
    // Get the array of blog IDs
    blogArray = data.blog_ids;

    // Create a div to hold the blog list of links
    blogEl = document.createElement("div");

    // Create a title element and set the title
    titleEl = document.createElement("h5");
    titleEl.innerHTML = "Your Blog Posts"

    // Append the title to teh div
    blogEl.appendChild(titleEl);

    // Create a nav element, add the class list and add it to the div
    navEl = document.createElement("nav");
    navEl.classList.add("nav", "flex-column");
    blogEl.appendChild(navEl);

    blogArray.forEach(element => {
        // Create a link element
        linkEl = document.createElement("a");

        // Set the class list
        linkEl.classList.add("nav-link", "link-secondary", "blog-link");

        // Set the ID
        linkEl.id = element.id;

        // Set the title
        linkEl.innerHTML = element.title;

        // Append the link to the nav element
        navEl.appendChild(linkEl);

        // Add a click event listener to load the blog text
        linkEl.addEventListener("click", event => {
            checkSocketAndSendMessage(event, GET_BLOG_TEXT)
        });
    });

    // Append all of this to the markdown output element
    markdownOutput.appendChild(blogEl);
};

function updateBlogText(event, data) {
    // Set the title
    titleInput.value = data.title;

    // Set the text
    textArea.value = data.text;

    // Convert the text to HTML
    updateMarkdownText(event);

    // Enable / Disable buttons
    saveButton.disabled = false;
    clearButton.disabled = false;
    titleInput.disabled = false
    textArea.disabled = false;

    // Set the text for the Load / Cancel button
    loadButton.innerHTML = "Load";
};

// Function to open a web socket
function openWebSocket(messageType) {
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
        // Parse the message into a json object
        data = JSON.parse(event.data);

        switch (data.message_type) {
            case MARKDOWN_UPDATE:
                // Update the markdown text
                updateMarkdown(data.body);
                break;

            case GET_BLOG_LIST:
                // Set the blog list
                updateBlogList(data.body);
                break;

            case GET_BLOG_TEXT:
                // Update the markdown text and convert to HTML
                updateBlogText(event, data.body);
                break;
        }
    };

    // Add the event listener
    ws.addEventListener('open', (event, messageType) => {
        sendMessage(event, messageType)
    });
};

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        // Accept tabs
        textareaAcceptTab("markdown-editor-textarea");

        // Override paste
        textareaOverridePaste("markdown-editor-textarea", updateMarkdownText);

        // Get the page URL
        url = document.URL;

        // Replace the http or https with ws or wss respectively
        if ( url.startsWith("https") ) {
            url = url.replace("https", "wss");
        } else if ( url.startsWith("http") ) {
            url = url.replace("http", "ws");
        }

        // Append the ws to the URL
        url = url + "ws";

        // If storage is available get the saved text into the title and text area
        if (storageAvailable('sessionStorage')) {
            titleInput.value = sessionStorage.getItem("title");
            textArea.value = sessionStorage.getItem('markDownText');
        }

        // Get the toast object
        var saveToastEl = document.getElementById('saveToast')
        saveToast = bootstrap.Toast.getOrCreateInstance(saveToastEl) // Returns a Bootstrap toast instance

        // Initialise mermaid
        mermaid.mermaidAPI.initialize({startOnLoad:true})

        // Create the new socket
        openWebSocket(MARKDOWN_UPDATE);

        // Enable the text input now that everything is ready
        textArea.disabled = false;
    }
});

function updateMarkdownText(event) {
    // If storage is available, save the text in the edit field
    if (storageAvailable('sessionStorage')) {
        sessionStorage.setItem('title', titleInput.value);
        sessionStorage.setItem('markDownText', textArea.value);
    }

    // Send a markdown message
    checkSocketAndSendMessage(event, MARKDOWN_UPDATE)
};

function checkSocketAndSendMessage(event, messageType) {
    // Send the messsage, checking that the socket is open
    // If the socket is not open, open a new one and wait for it to be ready
    if (ws.readyState != WebSocket.OPEN) {
        // Open the new socket
        openWebSocket(messageType);
    } else {
        // If the socket is already open, just send the message
        sendMessage(event, messageType);
    }
};

function sendMessage(event, messageType) {
    var saveData = false;

    if (!messageType) {
        messageType = MARKDOWN_UPDATE;
    }

    switch (messageType) {
        case MARKDOWN_UPDATE:
            // Check whether the Save button was pressed
            if (event.target.id === "save-button") {
                saveData = true
            }
        
            // Trim whitespace from the title field
            titleInput.value = titleInput.value.trim()

            // Create the message
            body = {
                title: titleInput.value,
                text: textArea.value,
                save_data: saveData
            };
            break;

        case GET_BLOG_LIST:
            // Empty body
            body = {};
            break;

        case GET_BLOG_TEXT:
            // Create the message body
            body = {
                id: event.target.id
            };
            break;

        default:
            break;
    }

    // Create the message
    msg = {
        message_type: messageType,
        body: body
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(msg));
};
