window.onUsersnapLoad = function (api) {
  // mountNode is an element in which the widget should be rendered
  api.init({ mountNode: document.getElementById("widgetContainer") });
};
var script = document.createElement("script");
script.defer = 1;
script.src =
  "https://widget.usersnap.com/embed/load/9395fd07-4d9d-4be1-91c5-d235501d63cb?onload=onUsersnapLoad";
document.getElementsByTagName("head")[0].appendChild(script);
