document.addEventListener('DOMContentLoaded', _ => {
    outerResize();
});

window.addEventListener('resize', _ => {
    outerResize();
});

function outerResize() {
    // Get the outer element
    outerElement = document.getElementById('outer');

    // Resize the outer element to the window size
    outerElement.style.width = window.innerWidth + 'px';
    outerElement.style.height = window.innerHeight + 'px';
}
