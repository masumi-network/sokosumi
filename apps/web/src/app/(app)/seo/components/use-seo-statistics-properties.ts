"use client";

import type {
  ProjectSeoStatisticsProperties,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/auth.client";
import {
  seoOwnerApiPath,
  seoViewerHeaders,
  seoWorkspaceOwner,
} from "@/lib/seo/owner";
import {
  type SeoStatisticsProvider,
  savedSeoStatistics,
  seoMatchingProperty,
} from "./seo-statistics-model";
import { useSeoConnectionStatus } from "./use-seo-connection";

const SEO_PROPERTIES_STALE_MS = 60_000;

/** Property discovery and an explicit choice share one cache across setup and automatic collection. */
export function useSeoStatisticsProperties(
  workspace: ProjectSeoWorkspace,
  provider: SeoStatisticsProvider,
  enabled: boolean,
) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const connection = useSeoConnectionStatus(provider, false).status;
  const owner = seoWorkspaceOwner(workspace);
  const viewer = [session?.session.activeOrganizationId, session?.user.id];
  const selectionKey = [
    "seo-statistics-property",
    ...viewer,
    owner.kind,
    owner.id,
    provider,
  ];
  const selection = useQuery<string>({
    queryKey: selectionKey,
    queryFn: async () => "",
    enabled: false,
  });
  const properties = useQuery<ProjectSeoStatisticsProperties>({
    queryKey: [
      "seo-properties",
      ...viewer,
      owner.kind,
      owner.id,
      provider,
      connection.data?.connectionVersion,
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
        void client.invalidateQueries({
          queryKey: ["seo-connection", ...viewer, provider],
          exact: true,
        });
      return data;
    },
    enabled: enabled && Boolean(session?.user.id),
    staleTime: SEO_PROPERTIES_STALE_MS,
    refetchOnWindowFocus: true,
  });
  const available = properties.data?.properties ?? [];
  const pages = workspace.pages.filter((page) =>
    workspace.scope.pageIds.includes(page.id),
  );
  // A GSC property must cover every selected page. One unrelated property is still unrelated.
  const candidates =
    provider === "search_console"
      ? available.filter(
          (property) =>
            pages.length > 0 &&
            pages.every(
              (page) =>
                seoMatchingProperty(provider, [property], page.url) ===
                property.id,
            ),
        )
      : available;
  const wanted =
    selection.data ||
    savedSeoStatistics(workspace.metrics, provider)?.propertyId;
  const propertyId = candidates.some((property) => property.id === wanted)
    ? (wanted ?? "")
    : seoMatchingProperty(provider, candidates, pages[0]?.url);
  const sitesWithoutProperty =
    provider === "search_console" &&
    !properties.isError &&
    properties.data?.status === "available" &&
    candidates.length === 0
      ? [...new Set(pages.map((page) => new URL(page.url).host))]
      : [];
  return {
    properties,
    eligibleProperties: candidates,
    sitesWithoutProperty,
    propertyId,
    setPropertyId: (value: string) => client.setQueryData(selectionKey, value),
    propertiesUnavailable:
      properties.isError || properties.data?.status === "unavailable",
  };
}
