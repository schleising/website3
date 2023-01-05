// Variable which will contain the websocket
var ws

// Add a callback for state changes
document.addEventListener('readystatechange', readyStateChanged)

document.getElementById("markdown-editor-textarea").addEventListener("keyup", function (event) {
    sendMessage(event)
});

// Disable the text entry box while the page loads
document.getElementById("markdown-editor-textarea").disabled = true;

function readyStateChanged(event) {
    // Check the page has completely loaded
    if (event.target.readyState === "complete") {

        // Get the page URL
        var url = document.URL;

        // Replace the http or https with ws or wss respectively
        if ( url.startsWith("https") ) {
            url = url.replace("https", "wss");
        } else if ( url.startsWith("http") ) {
            url = url.replace("http", "ws");
        }

        // Append the ws to the URL
        url = url + "ws";
        
        console.log(url);

        // Create a new WebSocket
        ws = new WebSocket(url);

        // Setup callback for onmessage event
        ws.onmessage = function(event) {
            // When a message is received from the server, set it as the innerHTML value
            document.getElementById("markdown-output").innerHTML = event.data;
        };

        // Enable the text input now that everything is ready
        document.getElementById("markdown-editor-textarea").disabled = false;
    }
};

function sendMessage(event) {
    // Get the text from the text area and create a JSON object from it
    var body = {text: document.getElementById("markdown-editor-textarea").value}

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(body))

    // Not sure why we need this...
    event.preventDefault()
};
