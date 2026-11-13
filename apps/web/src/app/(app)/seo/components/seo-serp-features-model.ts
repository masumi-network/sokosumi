import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { normalizeQuery } from "./seo-search-model";

type Series = NonNullable<ProjectSeoWorkspace["serpHistory"]>[number];
type Keyword = ProjectSeoWorkspace["keywords"][number];

/** SERP features the markers name, as DataForSEO item types. Each has a label in `keywords.serp.feature`. */
export const SEO_SERP_NAMED_FEATURES = [
  "video",
  "short_videos",
  "images",
  "local_pack",
  "top_stories",
  "discussions_and_forums",
  "shopping",
  "knowledge_graph",
] as const;
type NamedFeature = (typeof SEO_SERP_NAMED_FEATURES)[number];
const NAMED = new Set<string>(SEO_SERP_NAMED_FEATURES);
/** Item types with a column of their own, or that are no SERP feature. */
const NOT_COUNTED = new Set([
  "organic",
  "paid",
  "ai_overview",
  "featured_snippet",
  "people_also_ask",
]);

/**
 * "not_checked": the read did not ask for AI Overviews. It never reads as "no AI Overview". "undetermined": an
 * AI Overview shows, but a Google-wrapped reference on the page's host hides whether it cites the page.
 */
export type SeoAiOverviewMark =
  | "cited"
  | "shown"
  | "undetermined"
  | "absent"
  | "not_checked";

export type SeoSerpMarker =
  | { date: Date; device: Series["device"]; suspect: true }
  | {
      date: Date;
      device: Series["device"];
      suspect: false;
      aiOverview: SeoAiOverviewMark;
      featured: "owned" | "other" | "none";
      /** The People also ask box: an answer links the page's site, it shows, or it does not. */
      peopleAlsoAsk: "owned" | "shown" | "none";
      features: NamedFeature[];
      /** Features of other types, counted only. */
      otherFeatures: number;
    };

/**
 * What the SERP showed for a keyword row group on each check, newest first, one entry per device read. A suspect
 * read carries no SERP data: it is named, not read.
 */
export function seoSerpMarkers(
  serpHistory: ProjectSeoWorkspace["serpHistory"],
  reads: Pick<Keyword, "keyword" | "countryCode" | "languageCode" | "device">[],
): SeoSerpMarker[] {
  const devices = new Set(reads.map((row) => row.device));
  const lead = reads[0];
  if (!lead || !serpHistory) return [];
  const key = normalizeQuery(lead.keyword);
  return serpHistory
    .filter(
      (series) =>
        normalizeQuery(series.keyword) === key &&
        series.countryCode === lead.countryCode &&
        series.languageCode === lead.languageCode &&
        // A row without a device is one read of every device.
        (devices.has(null) || devices.has(series.device)),
    )
    .flatMap((series) =>
      series.points.map((point): SeoSerpMarker => {
        const date = new Date(point.observedAt);
        if (point.suspect)
          return { date, device: series.device, suspect: true };
        const types = new Set(point.itemTypes);
        const ai = point.aiOverview;
        return {
          date,
          device: series.device,
          suspect: false,
          aiOverview: !ai
            ? "not_checked"
            : !ai.shown
              ? "absent"
              : ai.pageCited === null
                ? "undetermined"
                : ai.pageCited
                  ? "cited"
                  : "shown",
          featured: !point.featured
            ? "none"
            : point.featured.pageOwned
              ? "owned"
              : "other",
          peopleAlsoAsk: point.paaOwned
            ? "owned"
            : types.has("people_also_ask")
              ? "shown"
              : "none",
          features: SEO_SERP_NAMED_FEATURES.filter((type) => types.has(type)),
          otherFeatures: [...types].filter(
            (type) => !NAMED.has(type) && !NOT_COUNTED.has(type),
          ).length,
        };
      }),
    )
    .sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() ||
        String(a.device).localeCompare(String(b.device)),
    );
}
