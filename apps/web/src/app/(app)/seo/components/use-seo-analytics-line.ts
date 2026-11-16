"use client";

import {
  seoAnalyticsAction,
  seoAnalyticsHidden,
  seoAnalyticsState,
} from "./seo-agent-statistics-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * Why the Agent tab has no Google Analytics data, and its fix. The tab reads it too: a hidden line with no
 * upkeep message leaves the tab to say that nothing is waiting.
 */
export function useSeoAnalyticsLine(
  model: SeoWorkspaceModel,
  /** The tab has an Analytics step: without one, nothing is read. */
  enabled: boolean,
) {
  const status = useSeoConnectionStatus("ga4", enabled).status.data?.status;
  const connected = status === "connected";
  const { properties, propertyId } = useSeoStatisticsProperties(
    model.data,
    "ga4",
    enabled && connected,
  );
  const listed =
    properties.data?.status === "available" ? properties.data.properties : null;
  const analytics = seoAnalyticsState({
    status,
    sync: model.statisticsSync.analytics,
    properties: listed?.length ?? null,
    picked: Boolean(propertyId),
  });
  return {
    analytics,
    count: listed?.length ?? 0,
    // The one property of an account is read even when its name is not the site's: the line names it.
    property: listed?.find((item) => item.id === propertyId)?.name ?? "",
    action: seoAnalyticsAction(analytics, connected, listed?.length ?? 0),
    hidden: seoAnalyticsHidden(analytics, connected),
  };
}

export type SeoAnalyticsLine = ReturnType<typeof useSeoAnalyticsLine>;
