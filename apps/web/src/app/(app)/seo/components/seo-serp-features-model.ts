import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoHost } from "./seo-competitors-model";
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
 * "not_checked": the read did not ask for AI Overviews. It never reads as "no AI Overview". "site_cited": the AI
 * Overview cites a page on a checked page's site, and not the checked page or not provably. "undetermined": an
 * AI Overview shows, no reference matches the page by URL and a Google-wrapped reference has no known domain or a
 * domain on the page's host (not determined).
 * "cited" names the row's page: the check read that page alone. A check of several pages cites one of them
 * ("cited_checked"), and the read does not say which. "other_page": the check did not read the row's page, so
 * its citation says nothing about it. A row without a page reads the check's pages together.
 */
export type SeoAiOverviewMark =
  | "cited"
  | "cited_checked"
  | "other_page"
  | "site_cited"
  | "site_cited_checked"
  | "shown"
  | "undetermined"
  | "absent"
  | "not_checked";

export type SeoSerpMarker =
  | {
      date: Date;
      device: Series["device"];
      observationId: string;
      suspect: true;
    }
  | {
      date: Date;
      device: Series["device"];
      observationId: string;
      suspect: false;
      aiOverview: SeoAiOverviewMark;
      /** The sites the AI Overview cites, once each; `own` is a checked page's site, listed first. */
      aiSources: { domain: string; own: boolean }[];
      featured: "owned" | "checked_site" | "other" | "none";
      /** The People also ask box: an answer links the page's site, it shows, or it does not. */
      peopleAlsoAsk: "owned" | "checked_site" | "shown" | "none";
      features: NamedFeature[];
      /** Features of other types, counted only. */
      otherFeatures: number;
    };

/** A page URL as Core keys it: the fragment does not name another page. */
function pageKey(url: string) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

// A host name with a dot and a letter-first last label: "Reddit", "2026" and "editor@a.test" name no site.
const SOURCE_HOST = /^(?:[\p{L}\p{N}_-]+\.)+\p{L}[\p{L}\p{N}-]*\.?$/u;
/** A stored cited source as a site, or none when the value names no host. No URL.canParse: Safari 16.4 lacks it. */
const sourceHost = (source: string) => {
  let host = source;
  if (/^https?:\/\//i.test(source)) {
    try {
      host = new URL(source).hostname;
    } catch {
      return [];
    }
  }
  // seoHost gives the form the checked pages have (lower case, punycode, no "www.").
  return SOURCE_HOST.test(host)
    ? [seoHost(`https://${host}`).replace(/\.$/, "")]
    : [];
};

/**
 * What the SERP showed for a keyword row group on each check, newest first, one entry per device read. A suspect
 * read carries no SERP data: it is named, not read.
 */
export function seoSerpMarkers(
  serpHistory: ProjectSeoWorkspace["serpHistory"],
  reads: Pick<
    Keyword,
    "keyword" | "countryCode" | "languageCode" | "device" | "pageUrl"
  >[],
): SeoSerpMarker[] {
  const devices = new Set(reads.map((row) => row.device));
  const lead = reads[0];
  if (!lead || !serpHistory) return [];
  const key = normalizeQuery(lead.keyword);
  const page = lead.pageUrl === null ? null : pageKey(lead.pageUrl);
  const pageHost = page === null ? null : seoHost(page);
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
        const { observationId } = point;
        if (point.suspect)
          return { date, device: series.device, observationId, suspect: true };
        const types = new Set(point.itemTypes);
        const ai = point.aiOverview;
        const checked = point.pages.flatMap((index) => {
          const url = series.pageUrls[index];
          return url === undefined ? [] : [pageKey(url)];
        });
        const checkedHosts = new Set(checked.map(seoHost));
        const featuredHost = point.featured?.domain
          ? seoHost(`https://${point.featured.domain}`)
          : null;
        // Older reads can hold "www." twins of a domain.
        const aiSources = [
          ...new Set((ai?.citedDomains ?? []).flatMap(sourceHost)),
        ]
          .map((domain) => ({ domain, own: checkedHosts.has(domain) }))
          .sort((a, b) => Number(b.own) - Number(a.own));
        // siteCited covers every checked page's site: it names the row's site only when no other site can be meant.
        const rowSiteCited =
          pageHost !== null &&
          (checkedHosts.size === 1 ||
            aiSources.some((source) => source.domain === pageHost));
        return {
          date,
          device: series.device,
          observationId,
          suspect: false,
          aiOverview: !ai
            ? "not_checked"
            : !ai.shown
              ? "absent"
              : page !== null && !checked.includes(page)
                ? "other_page"
                : ai.pageCited !== true && ai.siteCited === true
                  ? rowSiteCited
                    ? "site_cited"
                    : "site_cited_checked"
                  : ai.pageCited === null
                    ? "undetermined"
                    : !ai.pageCited
                      ? "shown"
                      : page !== null && checked.length === 1
                        ? "cited"
                        : "cited_checked",
          aiSources,
          featured: !point.featured
            ? "none"
            : pageHost !== null && featuredHost !== null
              ? featuredHost === pageHost
                ? "owned"
                : "other"
              : point.featured.pageOwned
                ? "checked_site"
                : "other",
          // The worker proves that PAA links one selected host, but does not name which one.
          peopleAlsoAsk: point.paaOwned
            ? pageHost !== null &&
              checkedHosts.size === 1 &&
              checkedHosts.has(pageHost)
              ? "owned"
              : "checked_site"
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
