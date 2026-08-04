"use client";

import { type ComponentType, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

interface LoadedAnalytics {
  Analytics: ComponentType;
  SpeedInsights: ComponentType;
}

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

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
