window.onresize = updateSize;

updateSize();

document.getElementById("hamburger-button").addEventListener("click", function(event) {
    hamburgerClicked()
});

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
    sidebarElement = document.getElementById("sidebar");

    if (sidebarElement.style.display == "flex") {
        sidebarElement.style.display = "none";
    } else {
        sidebarElement.style.display = "flex";
    }
};

function checkForEnter(event, baseUrl, element, callback) {
    if (event.key == "Enter") {
        searchClicked(baseUrl, element, callback);
    }
};

function searchClicked(baseUrl, element, callback) {
    value = document.getElementById(element).value;

    if (value != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + value;
        xmlhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                var jsn = this.responseText;
                callback(jsn);
            }
        };
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    }
};

function textareAcceptTab(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
        if (e.key == 'Tab') {
          e.preventDefault();
          var start = this.selectionStart;
          var end = this.selectionEnd;
      
          // set textarea value to: text before caret + tab + text after caret
          this.value = this.value.substring(0, start) +
            "\t" + this.value.substring(end);
      
          // put caret at right position again
          this.selectionStart =
            this.selectionEnd = start + 1;
        }
    });
};
