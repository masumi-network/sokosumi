"use client";

import type { SpeedInsights as SpeedInsightsComponent } from "@vercel/speed-insights/next";
import type { ComponentProps } from "react";

import { useClientAnalyticsModules } from "@/hooks/effects/use-client-analytics-modules";

type BeforeSend = NonNullable<
  ComponentProps<typeof SpeedInsightsComponent>["beforeSend"]
>;

// The Speed Insights script loads after mount, which in a background tab is
// after the tab becomes visible. Its web-vitals then treat the load as visible
// from the start and report the hidden time as FCP/LCP (tens of seconds for a
// Cmd-clicked task). Chrome records the load's first visibility state, so drop
// those loads; browsers without the entries keep reporting.
const dropBackgroundTabLoads: BeforeSend = (event) =>
  performance.getEntriesByType("visibility-state")[0]?.name === "hidden"
    ? null
    : event;

export function ClientAnalytics() {
  const loaded = useClientAnalyticsModules();

  if (!loaded) {
    return null;
  }

  const { Analytics, SpeedInsights } = loaded;

  return (
    <>
      <Analytics />
      <SpeedInsights beforeSend={dropBackgroundTabLoads} />
    </>
  );
}
