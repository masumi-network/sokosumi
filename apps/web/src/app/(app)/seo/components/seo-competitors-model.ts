import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

type Competitor = ProjectSeoWorkspace["competitors"][number];

/**
 * Sites that hold a place in many search results and are no rival of a
 * business site: video, forums, encyclopedias, stores and vendor help pages.
 * An entry matches its own host and every subdomain of it.
 */
export const SEO_PLATFORM_HOSTS = [
  "youtube.com",
  "reddit.com",
  "wikipedia.org",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "pinterest.com",
  "tiktok.com",
  "medium.com",
  "github.com",
  "stackoverflow.com",
  "stackexchange.com",
  "superuser.com",
  "news.ycombinator.com",
  "amazon.com",
  "apps.apple.com",
  "support.apple.com",
  "discussions.apple.com",
  "play.google.com",
  "support.google.com",
  "support.microsoft.com",
  "answers.microsoft.com",
] as const;

/** A forum or a community of any vendor is no rival either: the first label of its host says so. */
const SEO_PLATFORM_LABELS = [
  "forum",
  "forums",
  "community",
  "discussions",
  "answers",
];

function isPlatform(host: string) {
  const labels = host.split(".");
  return (
    SEO_PLATFORM_HOSTS.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    ) ||
    (labels.length > 2 && SEO_PLATFORM_LABELS.includes(labels[0]))
  );
}

/** The site of a URL: its host without "www.". A value that is no URL stays as written. */
export function seoHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const UNRANKED = Number.POSITIVE_INFINITY;

export type SeoCompetitorSite = {
  host: string;
  /** The page the row shows: a page the reader chose, else the best placed one. */
  lead: Competitor;
  /** Every page of the site, the lead first. */
  pages: Competitor[];
  /** The best place a page of the site holds; null where no page has one. */
  best: number | null;
};

/**
 * Competitor pages as one row per site. A check lists several pages of one
 * site; a site is one rival. The sites the reader chose come first, then the
 * best placed; sites without a place keep the order of the check. Platforms are
 * apart: a site the reader chose is never one.
 */
export function competitorSites(rows: Competitor[]) {
  const chosen = (row: Competitor) => row.confirmed || row.source === "saved";
  const all = [...Map.groupBy(rows, (row) => seoHost(row.url))].map(
    ([host, group]): SeoCompetitorSite & { platform: boolean } => {
      const pages = group.toSorted(
        (left, right) =>
          Number(chosen(right)) - Number(chosen(left)) ||
          (left.rank ?? UNRANKED) - (right.rank ?? UNRANKED),
      );
      const ranks = pages.flatMap((row) =>
        row.rank === null ? [] : [row.rank],
      );
      return {
        host,
        lead: pages[0],
        pages,
        best: ranks.length ? Math.min(...ranks) : null,
        platform: !pages.some(chosen) && isPlatform(host),
      };
    },
  );
  const ordered = all.toSorted(
    (left, right) =>
      Number(chosen(right.lead)) - Number(chosen(left.lead)) ||
      (left.best ?? UNRANKED) - (right.best ?? UNRANKED),
  );
  return {
    sites: ordered.filter((site) => !site.platform),
    platforms: ordered.filter((site) => site.platform),
  };
}
