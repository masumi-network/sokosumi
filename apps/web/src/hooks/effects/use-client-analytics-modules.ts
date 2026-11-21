"use client";

import type { SpeedInsights as SpeedInsightsComponent } from "@vercel/speed-insights/next";
import { type ComponentType, useEffect, useState } from "react";

export interface LoadedAnalytics {
  Analytics: ComponentType;
  SpeedInsights: typeof SpeedInsightsComponent;
}

/**
 * Dynamically imports Vercel Analytics and Speed Insights on mount so they stay
 * out of the initial client bundle, dropping the result if unmounted first.
 */
export function useClientAnalyticsModules(): LoadedAnalytics | null {
  const [loaded, setLoaded] = useState<LoadedAnalytics | null>(null);

  useEffect(() => {
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
  }, []);

  return loaded;
}
