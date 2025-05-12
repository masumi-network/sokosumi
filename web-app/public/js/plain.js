(function (d, script) {
  script = d.createElement("script");
  script.async = false;
  script.onload = function () {
    Plain.init({
      appId: "liveChatApp_01JAFM75T0VXH1PM8Y7N08M47Q",
      title: "Welcome to our Support!",
      theme: "light",
      requireAuthentication: true,
      threadDetails: {
        labelTypeIds: ["lt_01JV28PRQQP9PYD9STAAF98GM4"],
      },
      style: {
        chatButtonColor: "000000",
        chatButtonIconColor: "FF6641",
      },
    });
  };
  script.src = "https://chat.cdn-plain.com/index.js";
  d.getElementsByTagName("head")[0].appendChild(script);
})(document);
