// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

const FIELD_ORDER = [
    "registration",
    "icao24",
    "manufacturerIcao",
    "manufacturerName",
    "country",
    "model",
    "typecode",
    "serialNumber",
    "lineNumber",
    "icaoAircraftClass",
    "operator",
    "operatorCallsign",
    "operatorIcao",
    "operatorIata",
    "owner",
    "registered",
    "regUntil",
    "status",
    "built",
    "firstFlightDate",
    "firstSeen",
    "engines",
    "modes",
    "adsb",
    "acars",
    "categoryDescription",
    "prevReg",
    "nextReg",
    "selCal",
    "vdl"
];

const FIELD_LABELS = {
    registration: "Tail Number",
    icao24: "Mode S",
    manufacturerIcao: "Manufacturer ICAO",
    manufacturerName: "Manufacturer Name",
    country: "Country",
    model: "Model",
    typecode: "Type Code",
    serialNumber: "Serial Number",
    lineNumber: "Line Number",
    icaoAircraftClass: "ICAO Aircraft Class",
    operator: "Operator",
    operatorCallsign: "Operator Call Sign",
    operatorIcao: "Operator ICAO",
    operatorIata: "Operator IATA",
    owner: "Owner",
    registered: "Registered On",
    regUntil: "Registered Until",
    status: "Status",
    built: "Built On",
    firstFlightDate: "First Flight Date",
    firstSeen: "First Seen",
    engines: "Engines",
    modes: "Modes",
    adsb: "ADSB",
    acars: "ACARS",
    categoryDescription: "Category Description",
    prevReg: "Previous Registration",
    nextReg: "Next Registration",
    selCal: "SELCAL",
    vdl: "VDL"
};

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
        url = url + "ws/";

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
    const outputContainer = document.getElementById("aircraft_output");
    const outputMessage = document.getElementById("aircraft_output_message");
    const cardContainer = document.getElementById("aircraft_card");
    const introContainer = document.getElementById("aircraft_intro");

    cardContainer.replaceChildren();
    outputContainer.classList.remove("has-result");
    outputContainer.classList.remove("has-message");
    if (introContainer) {
        introContainer.classList.add("hidden");
    }

    if (dataset === null) {
        outputMessage.textContent = "No aircraft found for that tail number.";
        outputContainer.classList.add("has-message");
        return;
    }

    const renderedFields = FIELD_ORDER
        .filter(key => !isEmptyValue(dataset[key]))
        .map(key => createAircraftField(FIELD_LABELS[key] || key, dataset[key]));

    if (renderedFields.length === 0) {
        outputMessage.textContent = "No aircraft details available for that result.";
        outputContainer.classList.add("has-message");
        return;
    }

    outputMessage.textContent = "";
    cardContainer.append(createAircraftCard(dataset, renderedFields));
    outputContainer.classList.add("has-result");
};

function createAircraftCard(dataset, fields) {
    const cardElement = document.createElement("article");
    cardElement.className = "aircraft-result-card site-card";

    const headingElement = document.createElement("h4");
    headingElement.className = "aircraft-result-title";
    const displayRegistration = decodeFieldValue(dataset.registration);
    headingElement.textContent = displayRegistration.length > 0
        ? "Aircraft Details - " + displayRegistration
        : "Aircraft Details";

    const fieldGridElement = document.createElement("div");
    fieldGridElement.className = "aircraft-field-grid";
    fieldGridElement.append(...fields);

    cardElement.append(headingElement, fieldGridElement);
    return cardElement;
}

function createAircraftField(label, value) {
    const fieldElement = document.createElement("article");
    fieldElement.className = "aircraft-field";

    const labelElement = document.createElement("h4");
    labelElement.className = "aircraft-field-label";
    labelElement.textContent = label;

    const valueElement = document.createElement("p");
    valueElement.className = "aircraft-field-value";
    valueElement.textContent = decodeFieldValue(value);

    fieldElement.append(labelElement, valueElement);
    return fieldElement;
}

function isEmptyValue(value) {
    if (value === null || value === undefined) {
        return true;
    }

    if (typeof value === "string") {
        const decodedValue = decodeFieldValue(value);
        return decodedValue.trim().length === 0;
    }

    return false;
}

function decodeFieldValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value !== "string") {
        return String(value);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(value, "text/html");
    return extractTextWithBreaks(doc.body).replace(/\u00A0/g, " ").trim();
}

function extractTextWithBreaks(node) {
    let result = "";

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            result += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === "BR") {
                result += "\n";
            } else {
                result += extractTextWithBreaks(child);
            }
        }
    }

    return result;
}

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
