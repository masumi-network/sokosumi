import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
  SeoSiteTrafficReport,
} from "@sokosumi/core-client";
import { seoSearchSiteHost } from "@sokosumi/utils";
import { z } from "zod";
import { SEO_MAX_PAGES } from "./seo-form-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export type SeoTrafficChannel = ProjectSeoMetric["channel"];
/** The traffic a Google Analytics read counts. Search Console reads organic search only. */
export const SEO_TRAFFIC_CHANNELS = [
  "all",
  "organic",
  "ai_assistant",
] as const satisfies readonly SeoTrafficChannel[];
/** The message key that names a traffic channel. */
export function seoChannelLabel(channel: SeoTrafficChannel) {
  return channel === "organic"
    ? "statistics.channelOrganic"
    : channel === "ai_assistant"
      ? "statistics.channelAiAssistant"
      : "statistics.channelAll";
}
export function seoTrafficChannel(value: string): SeoTrafficChannel | null {
  return (SEO_TRAFFIC_CHANNELS as readonly string[]).includes(value)
    ? (value as SeoTrafficChannel)
    : null;
}

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

/**
 * Discover and Google News sync no query rows: the same rule as Core's seoSearchTypeHasQueries.
 * Without a chosen type the view is web search.
 */
export function seoSearchTypeHasQueries(type: SeoSearchType | null): boolean {
  return type !== "discover" && type !== "googleNews";
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

/**
 * One key for a page in a Search Console row and in a Google Analytics read: the two can write the
 * same page with or without "www." and with or without a trailing slash. Null for a value that is no URL.
 */
function pageKey(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return `${seoSearchSiteHost(url)}${pathname.replace(/\/+$/, "")}${search}`;
  } catch {
    return null;
  }
}

/**
 * Organic key events per page from the newest organic Google Analytics read. `none` is a read with
 * rows where no page had a key event: most often the property has no key events set up.
 */
export function seoKeyEvents(landing: ProjectSeoWorkspace["landingPages"]) {
  if (!landing) return null;
  // Rows that are one page under two spellings add up.
  const byKey = new Map<string, number>();
  for (const row of landing.rows) {
    const key = pageKey(row.pageUrl);
    if (key !== null) byKey.set(key, (byKey.get(key) ?? 0) + row.keyEvents);
  }
  const skippedUrls = landing.skippedUrls ?? [];
  const skipped = new Set(skippedUrls.map(pageKey));
  // A response of an older Core version has no pageUrls: its rows keep their numbers, no page gets a 0.
  const selected = new Set((landing.pageUrls ?? []).map(pageKey));
  return {
    // The landing read can cover another period than the Search Console rows beside it.
    period: { from: landing.from, to: landing.to },
    /**
     * The key events of one page, or the message that says why there is no number. A page the read asked
     * for that has no row had no organic session: that is a measured 0. A page the read did not ask
     * for has no number, and 0 would be a claim. A URL the read left out, as written, says so before
     * the page's rows are read: "/shop" keeps its number when the read left only "/shop/" out. Two rows
     * of the table that are one page under two spellings both show that page's number.
     */
    cell(pageUrl: string) {
      if (skippedUrls.includes(pageUrl)) return "traffic.keyEventsNotRead";
      const key = pageKey(pageUrl);
      const events = key === null ? undefined : byKey.get(key);
      if (events !== undefined) return events;
      if (key === null) return "traffic.keyEventsNotSelected";
      if (skipped.has(key)) return "traffic.keyEventsNotRead";
      return selected.has(key) ? 0 : "traffic.keyEventsNotSelected";
    },
    none:
      landing.rows.length > 0 &&
      landing.rows.every((row) => row.keyEvents === 0),
  };
}

/** Visits from AI assistants by assistant and page, from the newest AI Assistant channel read. */
export function seoAiAssistants(
  landing: ProjectSeoWorkspace["aiAssistantPages"],
) {
  if (!landing) return null;
  return {
    rows: landing.sources ?? [],
    truncated: landing.truncated === true,
    period: { from: landing.from, to: landing.to },
  };
}

export function seoTrafficPageOptions(
  data: ProjectSeoWorkspace,
  siteUrl: string | null,
  sitePages: SeoSiteTrafficReport["pages"],
  urls?: string[],
) {
  const site = siteUrl && seoSearchSiteHost(siteUrl);
  const tracked = data.pages.filter(
    (page) => seoSearchSiteHost(page.url) === site,
  );
  const defaults = tracked
    .filter((p) => data.scope.pageIds.includes(p.id))
    .map((p) => p.url);
  const submittedByUrl = new Map(
    sitePages.map((page) => [page.url, page.submitted]),
  );
  const aliases = new Map(
    sitePages.flatMap((page) =>
      page.submitted.map((url) => [url, page.url] as const),
    ),
  );
  const selected = [
    ...new Set((urls ?? defaults).map((url) => aliases.get(url) ?? url)),
  ];
  const options = [
    ...new Set([
      ...tracked.map((page) => aliases.get(page.url) ?? page.url),
      ...sitePages.map((page) => page.url),
      ...selected,
    ]),
  ].sort();
  const selectedIds = tracked
    .filter(
      (page) =>
        selected.includes(page.url) ||
        selected.some((url) => submittedByUrl.get(url)?.includes(page.url)),
    )
    .map((page) => page.id);
  return { selected, options, selectedIds };
}

const savedUrls = z
  .array(z.url({ protocol: /^https?$/ }).max(4096))
  .min(1)
  .max(SEO_MAX_PAGES);

export function readTrafficPages(key: string) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? savedUrls.parse(JSON.parse(value)) : undefined;
  } catch {
    return undefined;
  }
}
export function saveTrafficPages(key: string, urls: string[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(urls));
  } catch {
    // The in-memory filter still works when browser storage is unavailable.
  }
}
