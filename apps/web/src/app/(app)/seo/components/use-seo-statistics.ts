"use client";

import type { ProjectSeoStatisticsProperties } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import {
  invalidSeoStatisticsPeriod,
  SEO_DEFAULT_STATISTICS_DAYS,
  type SeoStatisticsProvider,
  savedSeoStatistics,
  seoStatisticsPeriod,
} from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoStatistics(
  model: SeoWorkspaceModel,
  source?: SeoStatisticsProvider,
) {
  const t = useTranslations("App.Seo");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [workspace] = useState(() => model.data);
  const owner = seoWorkspaceOwner(workspace);
  const [saved] = useState(() => savedSeoStatistics(workspace.metrics, source));
  const [provider, setProvider] = useState<SeoStatisticsProvider>(
    source ?? (saved?.source === "search_console" ? "search_console" : "ga4"),
  );
  const [chosenPropertyId, setPropertyId] = useState(saved?.propertyId ?? "");
  const [channel, setChannel] = useState<"all" | "organic">(
    source && saved
      ? saved.channel
      : (model.filters.channel ?? saved?.channel ?? "all"),
  );
  const [defaultPeriod] = useState(() =>
    seoStatisticsPeriod(SEO_DEFAULT_STATISTICS_DAYS),
  );
  const [from, setFrom] = useState(saved?.from ?? defaultPeriod.from);
  const [to, setTo] = useState(saved?.to ?? defaultPeriod.to);
  const properties = useQuery<ProjectSeoStatisticsProperties>({
    queryKey: [
      "seo-properties",
      session?.session.activeOrganizationId,
      session?.user.id,
      owner.kind,
      owner.id,
      provider,
    ],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${seoOwnerApiPath(owner)}/statistics/properties?provider=${provider}`,
        {
          signal,
          cache: "no-store",
          headers: seoViewerHeaders(
            session?.user.id,
            session?.session.activeOrganizationId,
          ),
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw new Error("Statistics properties unavailable");
      const data: ProjectSeoStatisticsProperties = await response.json();
      if (data.status === "unavailable" || data.status === "not_connected")
        void queryClient.invalidateQueries({
          queryKey: [
            "seo-connection",
            session?.session.activeOrganizationId,
            session?.user.id,
            provider,
          ],
          exact: true,
        });
      return data;
    },
    enabled: !!session?.user.id,
    refetchOnWindowFocus: false,
  });
  const availableProperties = properties.data?.properties ?? [];
  const propertiesUnavailable =
    properties.isError || properties.data?.status === "unavailable";
  const propertyId = availableProperties.some(
    (item) => item.id === chosenPropertyId,
  )
    ? chosenPropertyId
    : availableProperties.length === 1
      ? availableProperties[0].id
      : "";
  const invalidDates = invalidSeoStatisticsPeriod(from, to);
  function changeProvider(value: string) {
    if (value !== "ga4" && value !== "search_console") return;
    setProvider(value);
    setPropertyId("");
  }
  function setPeriod(days: number) {
    const period = seoStatisticsPeriod(days);
    setFrom(period.from);
    setTo(period.to);
  }
  async function submit() {
    if (
      propertiesUnavailable ||
      invalidDates ||
      !properties.data?.properties.some(
        (property) => property.id === propertyId,
      )
    )
      return;
    const selectedChannel = provider === "search_console" ? "organic" : channel;
    const saved = await model.execute(
      {
        kind: "sync_statistics",
        body: {
          provider,
          propertyId,
          from,
          to,
          channel: selectedChannel,
          ...(workspace.scope.id
            ? {
                scopeId: workspace.scope.id,
                expectedScopeVersion: workspace.scope.version,
              }
            : { pageIds: workspace.scope.pageIds }),
        },
      },
      t("statistics.synced"),
    );
    if (saved) await model.setFilters({ channel: selectedChannel });
  }
  return {
    provider,
    changeProvider,
    propertyId,
    setPropertyId,
    channel,
    setChannel,
    properties,
    propertiesUnavailable,
    from,
    setFrom,
    to,
    setTo,
    setPeriod,
    invalidDates,
    submit,
  };
}
