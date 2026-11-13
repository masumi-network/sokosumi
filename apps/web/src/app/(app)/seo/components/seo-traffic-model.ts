import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
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
 * Organic key events per page from the newest Google Analytics read. A page without a row had
 * no session of the channel in the read, so it shows no number. `none` is a read with rows where no
 * page had a key event: most often the property has no key events set up.
 */
export function seoKeyEvents(landing: ProjectSeoWorkspace["landingPages"]) {
  if (!landing) return null;
  return {
    channel: landing.channel,
    // The landing read can cover another period than the Search Console rows beside it.
    period: { from: landing.from, to: landing.to },
    byPage: new Map(landing.rows.map((row) => [row.pageUrl, row.keyEvents])),
    // An empty AI Assistant read is no channel data; the AI assistants section says so.
    none:
      landing.rows.length > 0 &&
      landing.rows.every((row) => row.keyEvents === 0),
  };
}

/** Visits from AI assistants by assistant and page, from an AI Assistant channel read only. */
export function seoAiAssistants(landing: ProjectSeoWorkspace["landingPages"]) {
  if (landing?.channel !== "ai_assistant") return null;
  return {
    rows: landing.sources ?? [],
    truncated: landing.truncated === true,
    period: { from: landing.from, to: landing.to },
  };
}
