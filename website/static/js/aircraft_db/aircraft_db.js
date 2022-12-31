function searchClicked() {
    var xmlhttp = new XMLHttpRequest();
    var url = "/aircraft/tail_no/" + document.getElementById("input_tail_number").value
    xmlhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            var jsn = this.responseText;
            newData(jsn);
        }
    };
    xmlhttp.open("GET", url, true);
    xmlhttp.send();
};

function newData(jsn) {
    const dataset = JSON.parse(jsn);
    for (var key in dataset) {
        var element = document.getElementById(key)

        if (element) {
            element.innerHTML = dataset[key]
        }
    }
};
