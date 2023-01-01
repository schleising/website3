window.onresize = updateSize;

updateSize()

function updateSize() {
    document.getElementById("outer").style.height = window.innerHeight + "px";
};
