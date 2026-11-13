import type { ProjectSeoMetric } from "@sokosumi/core-client";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export type SeoSearchType = NonNullable<ProjectSeoMetric["searchType"]>;
/** Search Console search types in the order the filter lists them. Web search is the default view. */
export const SEO_SEARCH_TYPES = [
  "web",
  "image",
  "video",
  "news",
  "discover",
  "googleNews",
] as const satisfies readonly SeoSearchType[];

export function seoSearchType(value: string): SeoSearchType | null {
  return (SEO_SEARCH_TYPES as readonly string[]).includes(value)
    ? (value as SeoSearchType)
    : null;
}

/** The search type choice matters once Search Console data exists; a chosen type always shows, so it can be cleared. */
export function seoSearchTypeShown({
  data,
  filters,
}: Pick<SeoWorkspaceModel, "data" | "filters">): boolean {
  return (
    Boolean(filters.searchType) ||
    Boolean(data.searchQueries) ||
    data.metrics.some((metric) => metric.source === "search_console")
  );
}
