// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable for the Data Saved toast
var saveToast;

// Disable the text entry box while the page loads
document.getElementById("markdown-editor-textarea").disabled = true;

// Add a callback for key up in the title
document.getElementById("title-input").addEventListener("keyup", event => {
    // Save the title text
    if (storageAvailable("sessionStorage")) {
        sessionStorage.setItem("title", document.getElementById("title-input").value);
    }
});

// Add a callback for key up in the textarea
document.getElementById("markdown-editor-textarea").addEventListener("keyup", event => updateMarkdownText(event));

// Add button event listener to clear text
document.getElementById("clear-button").addEventListener('click', event => {
    // Clear the text from the title
    document.getElementById("title-input").value = "";

    // Clear the title storage item
    sessionStorage.setItem("title", "");

    // Clear the test from the textarea, the session storage is cleared by updateMarkdownText
    document.getElementById("markdown-editor-textarea").value = "";

    // Send the updated data to the server
    updateMarkdownText(event);
});

// On save being clicked send a Save Message
document.getElementById("save-button").addEventListener("click", event => checkSocketAndSendMessage(event));

// Function to open a web socket
function openWebSocket() {
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
        // Parse the message into a json object
        data = JSON.parse(event.data)

        // Add the formatted text to the control
        document.getElementById("markdown-output").innerHTML = data.markdown_text;

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

    // Add the event listener
    ws.addEventListener('open', event => sendMessage(event));
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
            document.getElementById("title-input").value = sessionStorage.getItem("title");
            document.getElementById("markdown-editor-textarea").value = sessionStorage.getItem('markDownText');
        }

        // Get the toast object
        var saveToastEl = document.getElementById('saveToast')
        saveToast = bootstrap.Toast.getOrCreateInstance(saveToastEl) // Returns a Bootstrap toast instance

        // Create the new socket
        openWebSocket();

        // Enable the text input now that everything is ready
        document.getElementById("markdown-editor-textarea").disabled = false;
    }
});

function updateMarkdownText(event) {
    // If storage is available, save the text in the edit field
    if (storageAvailable('sessionStorage')) {
        sessionStorage.setItem('markDownText', document.getElementById("markdown-editor-textarea").value);
    }

    // Send a markdown message
    checkSocketAndSendMessage(event)
};

function checkSocketAndSendMessage(event) {
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
    var saveData = false;

    if (event.target.id === "save-button") {
        saveData = true
    }

    // Trim whitespace from the title field
    document.getElementById("title-input").value = document.getElementById("title-input").value.trim()

    // Create the message
    body = {
        title: document.getElementById("title-input").value,
        text: document.getElementById("markdown-editor-textarea").value,
        save_data: saveData
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(body));
};
