window.onresize = updateSize;

updateSize()

function updateSize() {
    document.getElementById("width_div").innerHTML = window.innerWidth;
    document.getElementById("height_div").innerHTML = window.innerHeight;
};
