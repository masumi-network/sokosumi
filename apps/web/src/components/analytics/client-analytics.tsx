"use client";

import dynamic from "next/dynamic";

const Analytics = dynamic(() =>
  import("@vercel/analytics/next").then((mod) => mod.Analytics),
);

const SpeedInsights = dynamic(() =>
  import("@vercel/speed-insights/next").then((mod) => mod.SpeedInsights),
);

export function ClientAnalytics() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
