"use client";

import Script from "next/script";
import React, { useEffect } from "react";

export function PlainChat() {
  useEffect(() => {
    // performance.mark is being used as a feature use signal. While it is traditionally used for performance
    // benchmarking it is low overhead and thus considered safe to use in production and it is a widely available
    // existing API.
    // The performance measurement will be handled by Chrome Aurora

    performance.mark("mark_feature_usage", {
      detail: {
        feature: "plain-chat",
      },
    });
  }, []);

  const handleOnLoad = () => {
    if (window.Plain) {
      window.Plain.init({
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
    }
  };

  return (
    <Script
      id="plain_chat"
      src="https://chat.cdn-plain.com/index.js"
      strategy="afterInteractive"
      onLoad={handleOnLoad}
    />
  );
}
