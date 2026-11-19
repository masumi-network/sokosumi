"use client";

import {
  type SeoStatisticsProvider,
  savedSeoStatistics,
} from "./seo-statistics-model";
import type { SeoTrafficChannel } from "./seo-traffic-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The property and traffic of one Google source. The dialog shows each source in its own section. */
export function useSeoStatistics(
  model: SeoWorkspaceModel,
  provider: SeoStatisticsProvider,
) {
  const workspace = model.data;
  // No choice for the reader: Search Console counts Google search only, and for Google Analytics
  // an SEO audit reads organic search. A source that is saved keeps its channel, so the new
  // numbers show in the same view. AI assistant traffic in view is read as such.
  const channel: SeoTrafficChannel =
    provider === "search_console"
      ? "organic"
      : (model.filters.channel ??
        savedSeoStatistics(workspace.metrics, provider)?.channel ??
        "organic");
  // A source without an account has no properties to read: its section offers the connection.
  const connected =
    useSeoConnectionStatus(provider).status.data?.status === "connected";
  // The reader's choice, then the property of the last sync, then the one that names the site.
  const choices = useSeoStatisticsProperties(workspace, provider, connected);
  return {
    ...choices,
    provider,
    connected,
    channel,
  };
}
