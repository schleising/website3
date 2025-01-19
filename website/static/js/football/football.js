// Variable which will contain the websocket
var ws;

// Variable which will contain the websocket url
var url;

// Variable for the periodic task
var intervalId = null;

// Add a callback for state changes
document.addEventListener('readystatechange', event => {
    if (event.target.readyState === "complete") {
        console.log("Load Event")
        // Get the page URL
        url = document.URL;

        // Replace the http or https with ws or wss respectively
        if (url.startsWith("https")) {
            url = url.replace("https", "wss");
        } else if (url.startsWith("http")) {
            url = url.replace("http", "ws");
        }

        // Append the ws to the URL
        url = url + "ws/";

        // Check whether the websocket is open, if not open it
        openWebSocket();
    }
});

// Function to open a web socket
function openWebSocket() {
    console.log("Opening Websocket")
    // Create a new WebSocket
    ws = new WebSocket(url);

    // Setup callback for onmessage event
    ws.onmessage = event => {
        // Parse the message into a json object
        matches = JSON.parse(event.data);

        matches.matches.forEach(match => {
            var status;
            var home;
            var away;

            switch (match.status) {
                case 'SCHEDULED':
                case 'TIMED':
                case 'AWARDED':
                    status = 'Not Started';
                    break;
                case 'IN_PLAY':
                    if (match.minute != null) {
                        status = match.minute + '\'';

                        if (match.injury_time != null) {
                            status = status.slice(0, -1) + '+' + match.injury_time + '\'';
                        }
                    } else {
                        status = 'In Play';
                    }

                    break;
                case 'PAUSED':
                    status = 'Half Time';
                    break;
                case 'FINISHED':
                    status = 'Full Time';
                    break;
                case 'SUSPENDED':
                    status = 'Suspended';
                    break;
                case 'POSTPONED':
                    status = 'Postponed';
                    break;
                case 'CANCELLED':
                    status = 'Cancelled';
                    break;
            }

            if (match.score.full_time.home == null) {
                home = '-';
            } else {
                home = match.score.full_time.home;
            }

            if (match.score.full_time.away == null) {
                away = '-';
            } else {
                away = match.score.full_time.away;
            }

            scoreWidget = document.getElementById(match.id);
            scoreWidget.getElementsByClassName("match-status")[0].innerHTML = status;
            scoreWidget.getElementsByClassName("home-team-score")[0].innerHTML = home;
            scoreWidget.getElementsByClassName("away-team-score")[0].innerHTML = away;
        });
    };

    // Add the event listener
    ws.addEventListener('open', (event) => {
        console.log("Setting Interval")
        if (intervalId != null) {
            clearInterval(intervalId);
        }
        intervalId = setInterval(checkSocketAndSendMessage, 1000);
        checkSocketAndSendMessage();
    });
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
    msg = {
        messageType: 'get_scores'
    };

    // Convert the JSON to a string and send it to the server
    ws.send(JSON.stringify(msg));
};
