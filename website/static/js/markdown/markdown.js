// Variable which will contain the websocket
var ws

// Variable which will contain the websocket url
var url

// Disable the text entry box while the page loads
document.getElementById("markdown-editor-textarea").disabled = true;

// Add a callback for key up
document.getElementById("markdown-editor-textarea").addEventListener("keyup", event => updateMarkdownText(event))

// Add button event listener to clear text
document.getElementById("clear-button").addEventListener('click', event => {
    // Clear the test from the control
    document.getElementById("markdown-editor-textarea").value = ""

    // Send the updated data to the server
    updateMarkdownText(event)
});

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === Event "complete") {
        // Accept tabs
        textareaAcceptTab("markdown-editor-textarea");

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

        // If storage is available get the saved text into the text area
        if (storageAvailable('sessionStorage')) {
            document.getElementById("markdown-editor-textarea").value = sessionStorage.getItem('markDownText')
        }

        // Create the new socket
        openWebSocket();

        // Enable the text input now that everything is ready
        document.getElementById("markdown-editor-textarea").disabled = false;
    }
});

// Function to open a web socket
function openWebSocket() {
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => document.getElementById("markdown-output").innerHTML = event.data;

    // Add the event listener
    ws.addEventListener('open', event => sendMessage(event))
};

function updateMarkdownText(event) {
    // If storage is available, save the text in the edit field
    if (storageAvailable('sessionStorage')) {
        sessionStorage.setItem('markDownText', document.getElementById("markdown-editor-textarea").value)
    }

    // Send the messsage, checking that the socket is open
    // If the socket is not open, open a new one and wait for it to be ready
    if (ws.readyState != WebSocket.OPEN) {
        // Open the new socket
        openWebSocket();
    } else {
        // If the socket is already open, just send the message
        sendMessage(event);
    }
};

function sendMessage(event) {
    console.log(event)
    // Get the text from the text area and create a JSON object from it
    var body = {text: document.getElementById("markdown-editor-textarea").value};

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(body));
};
