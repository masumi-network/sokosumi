(function (d, script) {
  script = d.createElement("script");
  script.async = false;
  script.onload = function () {
    Plain.init({
      appId: "liveChatApp_01JAFM75T0VXH1PM8Y7N08M47Q",
      theme: "auto",
      requireAuthentication: true,
      threadDetails: {
        labelTypeIds: ["lt_01JV28PRQQP9PYD9STAAF98GM4"],
      },
      style: {
        brandColor: "#6600ff",
        brandBackgroundColor: "#6600ff",
        launcherIconColor: "#fafafa",
      },
      position: {
        right: "20px",
        bottom: "20px",
      },
      links: [
        {
          icon: "bulb",
          text: "Feedback and Feature Requests",
          url: "https://sokosumi.featurebase.app/",
        },
        {
          icon: "error",
          text: "Report an Agentic Service",
          url: "https://tally.so/r/mJbVEY",
        },
      ],
    });
  };
  script.src = "https://chat.cdn-plain.com/index.js";
  d.getElementsByTagName("head")[0].appendChild(script);
})(document);
