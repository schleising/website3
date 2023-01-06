var nav = document.getElementById("blog-list-nav");
var childArray = Array.from(nav.children)

childArray.forEach(element => {
    document.getElementById(element.id).addEventListener("click", event => {
        blogLinkClicked('/blog/blog_id/', element.id, populateBlogArea)
    });
});

function populateBlogArea(jsn) {
    data = JSON.parse(jsn)

    document.getElementById("blog-title").innerHTML = data.title
    document.getElementById("blog-view").innerHTML = data.text
};
