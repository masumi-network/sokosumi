"use client";
import type {
  SeoSiteTrafficInput,
  SeoSiteTrafficReport,
} from "@sokosumi/core-client";
import { seoSearchSiteHost } from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import { SEO_MAX_PAGES } from "./seo-form-model";
import { seoSiteUrl } from "./seo-shared";
import {
  SEO_DEFAULT_STATISTICS_DAYS,
  seoCheckPeriod,
  seoStatisticsPeriod,
} from "./seo-statistics-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const TRAFFIC_FRESH_MS = 5 * 60_000;
export function useSeoSiteTraffic(
  model: SeoWorkspaceModel,
  scope: SeoSiteTrafficInput["scope"],
  pageUrls?: string[],
  enabled = true,
  selectedIds: string[] = [],
) {
  const { data: session } = useSession();
  const connection = useSeoConnectionStatus("search_console").status;
  const connected =
    connection.data?.status === "connected" && !connection.isError;
  const siteUrl = seoSiteUrl(model.data);
  const site = siteUrl && seoSearchSiteHost(siteUrl);
  // A site's aggregate and ranked URLs come from Google. The tracked pages only identify known aliases.
  const anchors = model.data.pages
    .filter((page) => seoSearchSiteHost(page.url) === site)
    .slice(0, SEO_MAX_PAGES)
    .map((page) => page.id);
  const pageIds = selectedIds.length
    ? selectedIds.slice(0, SEO_MAX_PAGES)
    : anchors;
  const tooMany =
    scope === "selected" &&
    (!pageUrls?.length || pageUrls.length > SEO_MAX_PAGES);
  const choice = useSeoStatisticsProperties(
    { ...model.data, scope: { ...model.data.scope, pageIds } },
    "search_console",
    connected,
    undefined,
    pageUrls,
  );
  const owner = seoWorkspaceOwner(model.data);
  const dates =
    model.filters.to && !model.invalidDates
      ? seoCheckPeriod(SEO_DEFAULT_STATISTICS_DAYS, new Date(model.filters.to))
      : seoStatisticsPeriod(SEO_DEFAULT_STATISTICS_DAYS);
  const body: SeoSiteTrafficInput = {
    scope,
    propertyId: choice.propertyId,
    pageIds: [...pageIds].sort(),
    ...(pageUrls && { pageUrls: [...pageUrls].sort() }),
    includeDaily: true,
    searchType: model.filters.searchType ?? "web",
    from: model.filters.from ?? dates.from,
    to: model.filters.to ?? dates.to,
  };
  const available = Boolean(
    model.data.availableActions.canSyncMetrics &&
      session?.user.id &&
      connected &&
      !choice.propertiesUnavailable &&
      choice.propertyId &&
      body.pageIds.length &&
      !tooMany &&
      !model.invalidDates,
  );
  const query = useQuery<SeoSiteTrafficReport>({
    queryKey: [
      "seo-site-traffic",
      session?.user.id,
      session?.session.activeOrganizationId,
      owner,
      connection.data?.connectionVersion,
      body,
      // The split in the report follows the brand terms: a saved list reads this report again.
      model.data.brandTerms ?? [],
    ],
    enabled: enabled && available,
    staleTime: TRAFFIC_FRESH_MS,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await fetch(`${seoOwnerApiPath(owner)}/statistics/traffic`, {
        method: "POST",
        signal,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...seoViewerHeaders(
            session?.user.id,
            session?.session.activeOrganizationId,
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error("Site traffic unavailable");
      const report: SeoSiteTrafficReport = await r.json();
      if (
        report?.propertyId !== body.propertyId ||
        report.from !== body.from ||
        report.to !== body.to
      )
        throw Error("Search Console returned a different reporting scope");
      return report;
    },
  });
  return {
    propertyId: choice.propertyId,
    query,
    available,
    tooMany,
    retry:
      connection.isError || connection.data?.status === "unavailable"
        ? connection.refetch
        : connected && choice.propertiesUnavailable
          ? choice.properties.refetch
          : available && query.isError
            ? query.refetch
            : null,
    canChooseScope:
      model.data.availableActions.canSyncMetrics &&
      (connected ||
        connection.isError ||
        connection.data?.status === "unavailable"),
    pending:
      connection.isFetching || (connected && choice.properties.isFetching),
  };
}
