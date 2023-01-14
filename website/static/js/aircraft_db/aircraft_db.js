// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
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

        // Create the new socket
        openWebSocket();
    }
});

document.getElementById("search-button").addEventListener("click", function(event) {
    searchClicked('/aircraft/tail_no/', 'input_tail_number', parseAircraftData)
});

document.getElementById("input_tail_number").addEventListener("keyup", function(event) {
    if (!checkForEnter(event, '/aircraft/tail_no/', 'input_tail_number', parseAircraftData)){
        checkSocketAndSendMessage(event)
    }
});

function parseAircraftData(jsn) {
    const dataset = JSON.parse(jsn);
    for (var key in dataset) {
        var element = document.getElementById(key)

        if (element) {
            element.innerHTML = dataset[key]
        }
    }
};

// Function to open a web socket
function openWebSocket() {
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
        // Parse the message into a json object
        data = JSON.parse(event.data)

        // Clear the existing children from the datalist
        htmlList = document.getElementById("tail-number-datalist")
        htmlList.replaceChildren()

        // Add the tail numbers as options to the datalist
        data.tail_numbers.forEach(element => {
            // Create an option element
            newOption = document.createElement("option")

            // Set the tail number as the value
            newOption.value = element

            // Add this as a child to the datalist
            htmlList.appendChild(newOption)
        });
    };

    // Add the event listener
    ws.addEventListener('open', event => sendMessage(event));
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
    // Create the message
    body = {
        tail_no: document.getElementById("input_tail_number").value
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(body));
};
