window.onresize = updateSize;

updateSize();

function updateSize() {
    document.getElementById("outer").style.height = window.innerHeight + "px";

    if (window.innerWidth > 550) {
        document.getElementById("sidebar").style.display = "flex";
        document.getElementById("hamburger").style.display = "none";
    } else {
        document.getElementById("sidebar").style.display = "none";
        document.getElementById("hamburger").style.display = "block";
    }
};

function hamburgerClicked() {
    sidebarElement = document.getElementById("sidebar")

    if (sidebarElement.style.display == "flex") {
        sidebarElement.style.display = "none";
    } else {
        sidebarElement.style.display = "flex";
    }
};

function checkForEnter(event, baseUrl, element, callback) {
    if (event.key == "Enter") {
        searchClicked(baseUrl, element, callback)
    }
};

function searchClicked(baseUrl, element, callback) {
    var xmlhttp = new XMLHttpRequest();
    var url = baseUrl + document.getElementById(element).value
    xmlhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            var jsn = this.responseText;
            callback(jsn);
        }
    };
    xmlhttp.open("GET", url, true);
    xmlhttp.send();
};
