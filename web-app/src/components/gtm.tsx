"use client";

import Script from "next/script";
import React, { useEffect } from "react";

import { JSONValue } from "@/lib/utils";

export interface GTMProps {
  gtmId: string;
  gtmScriptUrl?: string;
  dataLayer?: { [key: string]: JSONValue };
  dataLayerName?: string;
  auth?: string;
  preview?: string;
  nonce?: string;
}

let currDataLayerName = "dataLayer";

export function GoogleTagManager(props: GTMProps) {
  const {
    gtmId,
    gtmScriptUrl = "https://www.googletagmanager.com/gtm.js",
    dataLayerName = "dataLayer",
    auth,
    preview,
    dataLayer,
    nonce,
  } = props;

  currDataLayerName = dataLayerName;

  const gtmLayer = dataLayerName !== "dataLayer" ? `&l=${dataLayerName}` : "";
  const gtmAuth = auth ? `&gtm_auth=${auth}` : "";
  const gtmPreview = preview ? `&gtm_preview=${preview}&gtm_cookies_win=x` : "";

  useEffect(() => {
    // performance.mark is being used as a feature use signal. While it is traditionally used for performance
    // benchmarking it is low overhead and thus considered safe to use in production and it is a widely available
    // existing API.
    // The performance measurement will be handled by Chrome Aurora

    performance.mark("mark_feature_usage", {
      detail: {
        feature: "gtm",
      },
    });
  }, []);

  return (
    <>
      <Script
        id="_next-gtm-init"
        dangerouslySetInnerHTML={{
          __html: `
        (function(w,l){
          w[l]=w[l]||[];
          w[l].push('consent','default',{'ad_personalization':'denied','ad_storage':'denied','ad_user_data':'denied','analytics_storage':'denied','wait_for_update':2000});
          w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});
          ${dataLayer ? `w[l].push(${JSON.stringify(dataLayer)})` : ""}
        })(window,'${dataLayerName}');`,
        }}
        nonce={nonce}
      />
      <Script
        id="_next-gtm"
        data-ntpc="GTM"
        src={`${gtmScriptUrl}?id=${gtmId}${gtmLayer}${gtmAuth}${gtmPreview}`}
        nonce={nonce}
        // mark this as text/plain for user consent approval
        type="text/plain"
        // add data-usercentrics attribute
        data-usercentrics="Google Tag Manager"
      />
    </>
  );
}

export const sendGTMEvent = (data: object, dataLayerName?: string) => {
  // special case if we are sending events before GTM init and we have custom dataLayerName
  const dataLayer = dataLayerName ?? currDataLayerName;
  // define dataLayer so we can still queue up events before GTM init
  // @ts-expect-error - window[dataLayer] is not typed
  window[dataLayer] = window[dataLayer] ?? [];
  // @ts-expect-error - window[dataLayer] is not typed
  window[dataLayer].push(data);
};
