window.onresize = updateSize;

updateSize();

function updateSize() {
    document.getElementById("outer").style.height = window.innerHeight + "px";
};

function checkForEnter(event, baseUrl, element, callback) {
    if (event.key == "Enter") {
        searchClicked(baseUrl, element, callback);
        return true;
    }
    return false;
};

function searchClicked(baseUrl, id, callback) {
    value = document.getElementById(id).value;

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

function blogLinkClicked(baseUrl, id, callback) {
    if (id != '') {
        var xmlhttp = new XMLHttpRequest();
        var url = baseUrl + id;
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

function textareaAcceptTab(id) {
    document.getElementById(id).addEventListener('keydown', function(event) {
        if (event.key == 'Tab') {
          event.preventDefault();
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

function textareaOverridePaste(id, callback) {
    document.getElementById(id).addEventListener('paste', function(event){
        event.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;

        // set textarea value to: text before caret + tab + text after caret
        this.value = this.value.substring(0, start) +
        event.clipboardData.getData("text") + this.value.substring(end);

        // put caret at right position again
        this.selectionStart =
        this.selectionEnd = start + event.clipboardData.getData("text").length

        callback(event)
    });
};

function storageAvailable(type) {
    let storage;
    try {
        storage = window[type];
        const x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            (storage && storage.length !== 0);
    }
}
