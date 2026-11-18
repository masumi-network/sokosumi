"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import { SEO_QUERY_RETRY_MS } from "./seo-agent-model";
import {
  SEO_DEFAULT_STATISTICS_DAYS,
  type SeoStatisticsProvider,
  savedSeoStatistics,
  seoStatisticsPeriod,
} from "./seo-statistics-model";
import type { SeoSearchType, SeoTrafficChannel } from "./seo-traffic-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";

const SEO_STATISTICS_BUSY_RETRY_MS = 15_000;
const SEO_STATISTICS_BUSY_RETRIES = 20;

export class SeoStatisticsCollectionBusyError extends Error {}

interface StatisticsContext {
  refreshBrief: () => Promise<void>;
  data: ProjectSeoWorkspace;
  viewerKey: string;
  enabled: boolean;
  channel: SeoTrafficChannel | null;
  searchType: SeoSearchType | null;
}

/** Each provider uses the same selected pages. Core owns freshness, account identity and concurrent collection. */
function useAutomaticProvider(
  context: StatisticsContext,
  provider: SeoStatisticsProvider,
) {
  const { data, enabled } = context;
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const connection = useSeoConnectionStatus(provider, enabled).status;
  const connected = connection.data?.status === "connected";
  const choice = useSeoStatisticsProperties(
    data,
    provider,
    enabled && connected,
  );
  const owner = seoWorkspaceOwner(data);
  const period = seoStatisticsPeriod(SEO_DEFAULT_STATISTICS_DAYS);
  const channel =
    provider === "search_console"
      ? "organic"
      : (context.channel ??
        savedSeoStatistics(data.metrics, provider)?.channel ??
        "organic");
  const collection = useQuery({
    queryKey: [
      "seo-statistics-automatic",
      context.viewerKey,
      owner.kind,
      owner.id,
      provider,
      provider === "search_console"
        ? data.keywords
            .filter((row) => row.saved)
            .map((row) =>
              JSON.stringify([
                row.keyword,
                row.countryCode,
                row.priority,
                row.version > 0,
                row.source === "focus",
              ]),
            )
            .sort()
        : null,
      connection.data?.connectionVersion,
      choice.propertyId,
      [...data.scope.pageIds].sort(),
      data.scope.id,
      data.scope.version,
      channel,
      provider === "search_console" ? context.searchType : null,
      period.from,
      period.to,
    ],
    enabled:
      enabled &&
      connected &&
      Boolean(choice.propertyId) &&
      !choice.propertiesUnavailable,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${seoOwnerApiPath(owner)}/statistics`, {
        method: "POST",
        signal,
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          ...seoViewerHeaders(
            session?.user.id,
            session?.session.activeOrganizationId,
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          automatic: true,
          provider,
          propertyId: choice.propertyId,
          ...period,
          channel,
          ...(provider === "search_console" && context.searchType
            ? { searchType: context.searchType }
            : {}),
          ...(data.scope.id
            ? {
                scopeId: data.scope.id,
                expectedScopeVersion: data.scope.version,
              }
            : { pageIds: data.scope.pageIds }),
        }),
      });
      if (response.status === 409)
        throw new SeoStatisticsCollectionBusyError(
          "Statistics collection is already in progress",
        );
      if (!response.ok)
        throw new Error("Automatic statistics collection did not complete");
      await Promise.all([
        context.refreshBrief(),
        queryClient.invalidateQueries({
          queryKey: [
            "seo-workspace",
            session?.session.activeOrganizationId,
            session?.user.id,
            owner.kind,
            owner.id,
          ],
        }),
      ]);
      return true;
    },
    // Core must reactivate the selected cached snapshot when a previous selection is revisited.
    staleTime: 0,
    retry: (count, error) =>
      error instanceof SeoStatisticsCollectionBusyError &&
      count < SEO_STATISTICS_BUSY_RETRIES,
    retryDelay: SEO_STATISTICS_BUSY_RETRY_MS,
    refetchOnWindowFocus: true,
    refetchInterval: SEO_QUERY_RETRY_MS,
  });
  const needsProperty =
    enabled &&
    connected &&
    choice.eligibleProperties.length > 0 &&
    !choice.propertyId;
  const failed =
    enabled &&
    (connection.isError ||
      (connected && (choice.propertiesUnavailable || collection.isError)));
  return {
    /** A collection finished for the property in use: an empty result is then a fact, not a guess. */
    collected: enabled && collection.isSuccess,
    loading:
      enabled &&
      (connection.isFetching ||
        (connected && choice.properties.isFetching) ||
        collection.isFetching),
    needsProperty,
    sitesWithoutProperty:
      enabled && connected ? choice.sitesWithoutProperty : [],
    failed,
    retry: async () => {
      if (connected && choice.propertyId && !choice.propertiesUnavailable)
        await collection.refetch();
      else if (connected) await choice.properties.refetch();
      else await connection.refetch();
    },
  };
}

/**
 * Previous behavior, replaced by shared context collection below:
 * Hands-off upkeep: Search Console data that is stale, or that lacks query rows
 * for over an hour, is refreshed once per browser session for this Audit and
 * page selection. It reuses the saved property and
 * the owner's existing native connection; nothing else runs unattended.
 */
// Collection now runs for initial snapshots and both providers in the shared workspace controller.
export function useSeoAutopilot(context: StatisticsContext) {
  const search = useAutomaticProvider(context, "search_console");
  const analytics = useAutomaticProvider(context, "ga4");
  const state: "idle" | "loading" | "failed" | "needs_property" =
    search.loading || analytics.loading
      ? "loading"
      : search.failed || analytics.failed
        ? "failed"
        : search.needsProperty || analytics.needsProperty
          ? "needs_property"
          : "idle";
  return {
    state,
    sitesWithoutProperty: search.sitesWithoutProperty,
    /** Google Analytics alone: the Agent tab names why its statistics are missing. */
    analytics: {
      collected: analytics.collected,
      loading: analytics.loading,
      failed: analytics.failed,
    },
    propertyProvider: search.needsProperty
      ? ("search_console" as const)
      : analytics.needsProperty
        ? ("ga4" as const)
        : undefined,
    retry: () => {
      void search.retry();
      void analytics.retry();
    },
  };
}
