function characterTyped(event, user) {
    var xmlhttp = new XMLHttpRequest();
    var url = "/markdown/convert"
    var body = {text: document.getElementById("markdown-editor-textarea").value}
    xmlhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            var jsn = this.responseText;
            callback(jsn);
        }
    };
    xmlhttp.open("POST", url, true);
    xmlhttp.setRequestHeader("Content-Type", "application/json")
    xmlhttp.send(JSON.stringify(body));
}

function callback(jsn) {
    var data = JSON.parse(jsn)

    document.getElementById("markdown-output").innerHTML = data
}
