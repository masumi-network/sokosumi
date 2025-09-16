"use client";

import Script from "next/script";
import React, { useEffect } from "react";

export interface GAProps {
  gaId: string;
  dataLayerName?: string;
  debugMode?: boolean;
  nonce?: string;
}

let currDataLayerName: string | undefined = undefined;

export function GoogleAnalytics(props: GAProps) {
  const { gaId, debugMode, dataLayerName = "dataLayer", nonce } = props;
  currDataLayerName = currDataLayerName ?? dataLayerName;

  useEffect(() => {
    // performance.mark is being used as a feature use signal. While it is traditionally used for performance
    // benchmarking it is low overhead and thus considered safe to use in production and it is a widely available
    // existing API.
    // The performance measurement will be handled by Chrome Aurora

    performance.mark("mark_feature_usage", {
      detail: {
        feature: "ga",
      },
    });
  }, []);

  return (
    <>
      <Script
        id="_next-ga-init"
        dangerouslySetInnerHTML={{
          __html: `
          window['${dataLayerName}'] = window['${dataLayerName}'] || [];
          function gtag(){window['${dataLayerName}'].push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}' ${debugMode ? ",{ 'debug_mode': true }" : ""});`,
        }}
        nonce={nonce}
      />
      <Script
        id="_next-ga"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        nonce={nonce}
        // mark this as text/plain for user consent approval
        type="text/plain"
        // add data-usercentrics attribute
        data-usercentrics="Google Ads"
      />
    </>
  );
}

export function sendGAEvent(..._args: object[]) {
  if (currDataLayerName === undefined) {
    console.warn(`GA has not been initialized`);
    return;
  }

  // @ts-expect-error - window[dataLayer] is not typed
  if (window[currDataLayerName]) {
    // @ts-expect-error - window[dataLayer] is not typed
    window[currDataLayerName].push(..._args);
  } else {
    console.warn(`GA dataLayer ${currDataLayerName} does not exist`);
  }
}
