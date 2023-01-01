window.onresize = updateSize;

updateSize()

function updateSize() {
    document.getElementById("width_div").innerHTML = "Width : " + window.innerWidth;
    document.getElementById("height_div").innerHTML = "Height: " + window.innerHeight;
};
