"use client";

import { useState } from "react";
import {
  type SeoStatisticsProvider,
  savedSeoStatistics,
} from "./seo-statistics-model";
import type { SeoTrafficChannel } from "./seo-traffic-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoStatistics(
  model: SeoWorkspaceModel,
  source?: SeoStatisticsProvider,
) {
  const workspace = model.data;
  const [saved] = useState(() => savedSeoStatistics(workspace.metrics, source));
  const [chosenProvider, setProvider] = useState<SeoStatisticsProvider | null>(
    source ??
      (saved
        ? saved.source === "search_console"
          ? "search_console"
          : "ga4"
        : null),
  );
  // Nothing saved and no source asked for: Google Analytics leads while it is connected, or where
  // an account state cannot be read. Else Search Console leads: it is connected, or it is the first
  // account to connect. A dialog on Google Analytics beside a connected Search Console had no sync.
  const search = useSeoConnectionStatus(
    "search_console",
    chosenProvider === null,
  ).status;
  const analytics = useSeoConnectionStatus(
    "ga4",
    chosenProvider === null,
  ).status;
  // The source is decided once, when both reads end. A later change of an account (a failed
  // property read, a disconnect in the dialog) must not move the dialog to the other source.
  if (chosenProvider === null && !search.isPending && !analytics.isPending)
    setProvider(
      search.data?.status !== undefined &&
        analytics.data?.status !== undefined &&
        analytics.data.status !== "connected"
        ? "search_console"
        : "ga4",
    );
  const provider: SeoStatisticsProvider = chosenProvider ?? "ga4";
  // The last sync of the source the dialog shows. A change of source in the dialog reads its own.
  const savedHere = savedSeoStatistics(workspace.metrics, provider);
  // No choice for the reader: Search Console counts Google search only, and for Google Analytics
  // an SEO audit reads organic search. A source that is saved keeps its channel, so the new
  // numbers show in the same view. AI assistant traffic in view is read as such.
  const channel: SeoTrafficChannel =
    provider === "search_console"
      ? "organic"
      : (model.filters.channel ?? savedHere?.channel ?? "organic");
  // No read for a source that is not decided yet: its answer would show for a moment.
  // The reader's choice, then the property of the last sync, then the one that names the site.
  const { properties, propertiesUnavailable, propertyId, setPropertyId } =
    useSeoStatisticsProperties(workspace, provider, chosenProvider !== null);
  function changeProvider(value: string) {
    if (value !== "ga4" && value !== "search_console") return;
    setProvider(value);
  }
  return {
    provider,
    changeProvider,
    propertyId,
    setPropertyId,
    channel,
    properties,
    propertiesUnavailable,
  };
}
