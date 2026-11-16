"use client";

import type { SpeedInsights as SpeedInsightsComponent } from "@vercel/speed-insights/next";
import { type ComponentProps, type ComponentType, useState } from "react";

import { getEnvPublicConfig } from "@/config/env.public";
import { useMountEffect } from "@/hooks/use-mount-effect";

interface LoadedAnalytics {
  Analytics: ComponentType;
  SpeedInsights: typeof SpeedInsightsComponent;
}

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
  const [loaded, setLoaded] = useState<LoadedAnalytics | null>(null);

  useMountEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("@vercel/analytics/next"),
      import("@vercel/speed-insights/next"),
    ]).then(([analyticsMod, speedInsightsMod]) => {
      if (cancelled) {
        return;
      }
      setLoaded({
        Analytics: analyticsMod.Analytics,
        SpeedInsights: speedInsightsMod.SpeedInsights,
      });
    });
    return () => {
      cancelled = true;
    };
  });

  if (!loaded) {
    return null;
  }

  const { Analytics, SpeedInsights } = loaded;

  // Web Analytics is enabled on the Mainnet Vercel project only. Elsewhere its
  // hashed `/<hex>/script.js` is not served, so the page gets HTML for a script
  // and logs a console error (the browser smoke in `e2e/` fails on it).
  return (
    <>
      {getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet" && <Analytics />}
      <SpeedInsights beforeSend={dropBackgroundTabLoads} />
    </>
  );
}
