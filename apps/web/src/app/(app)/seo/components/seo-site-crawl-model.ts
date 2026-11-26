import type { ProjectSeoSiteCrawl } from "@sokosumi/core-client";

type Crawled = Extract<ProjectSeoSiteCrawl, { state: "crawled" }>;
type PageChecks = NonNullable<Crawled["pageChecks"]>;

export const SEO_CRAWL_CHECKS = [
  "brokenLinks",
  "noindexInSitemap",
  "badCanonicals",
  "missingTitle",
  "redirectChains",
  "missingH1",
  "duplicateTitles",
  "orphans",
  "javascript",
] as const;
export type SeoCrawlCheck = (typeof SEO_CRAWL_CHECKS)[number];

/** A problem that keeps a page out of search, or sends readers to an error, is major; the others are minor. */
const MAJOR: ReadonlySet<SeoCrawlCheck> = new Set([
  "brokenLinks",
  "noindexInSitemap",
  "badCanonicals",
  "missingTitle",
]);

export type SeoCrawlStop = Crawled["stop"];
/** The SEO bot's word for an entry of a list. */
export type SeoCrawlKind =
  | "javascript"
  | Exclude<NonNullable<Crawled["links"]>["chains"][number]["kind"], "chain">
  | PageChecks["badCanonicals"]["pages"][number]["kind"];

/** One entry of a check's list: a URL or a text, with the facts the bot gave for it. */
export type SeoCrawlItem = {
  label: string;
  /** The label is a URL or a path pattern: it shows in the mono face. */
  url: boolean;
  status?: number | null;
  /** The count the check's own column names: linking pages, pages, shell pages. */
  count?: number;
  /** The SEO bot's own word for the entry, for example "loop" or "other host". */
  kind?: SeoCrawlKind;
  /** More URLs of the entry: the pages that link to it, its redirect hops, its canonical, or the pages that share a title. */
  urls?: string[];
};

export type SeoCrawlRow =
  | {
      check: SeoCrawlCheck;
      state: "found";
      severity: "major" | "minor";
      total: number;
      items: SeoCrawlItem[];
      /** Entries of the check the crawl could not judge, next to the ones it found. */
      notDetermined: number;
      /** The bot's reasons the check may have missed more. */
      reasons: string[];
      /** Orphans only: a script may add a link to a listed page. */
      candidates?: boolean;
    }
  | {
      check: SeoCrawlCheck;
      state: "not determined";
      /** The SEO bot's reasons, in its own words. */
      reasons: string[];
      /** Entries left out when the bot gave no reason: the view says how many. */
      notDetermined: number;
      /** Why the check has no result, when the bot gave no reason and left nothing out. */
      empty: SeoCrawlEmpty;
    }
  | { check: SeoCrawlCheck; state: "clear" };

/** missing: the report has no result; noSitemapPage: the sitemap names no page on the site; olderReport: the report predates the check. */
export type SeoCrawlEmpty = "missing" | "noSitemapPage" | "olderReport";

export type SeoCrawlView =
  | { state: "not crawled"; reason: string }
  | {
      state: "crawled";
      read: number;
      stop: SeoCrawlStop;
      /** Problems first (major, then minor), then the checks the crawl could not decide. */
      rows: Exclude<SeoCrawlRow, { state: "clear" }>[];
      clear: SeoCrawlCheck[];
      /** What the crawl could not see that no shown check names, in the bot's words. */
      otherGaps: { item: string; reason: string }[];
    };

/** The SEO bot's couldNotSee items that speak about one check. */
const GAP_CHECKS: {
  check: SeoCrawlCheck[];
  item: (item: string) => boolean;
}[] = [
  {
    // A crawl that stopped early, or left links unfollowed, did not check each linked page.
    check: ["brokenLinks", "redirectChains"],
    item: (item) =>
      item === "Broken internal links" ||
      item === "Pages past where the crawl stopped" ||
      (item.startsWith("At least ") &&
        item.endsWith(" the crawl did not follow")),
  },
  { check: ["orphans"], item: (item) => item === "Orphan pages" },
  {
    // Both sitemap checks read only the sitemap URLs the bot got.
    check: ["noindexInSitemap", "orphans"],
    item: (item) => item === "Some sitemap URLs",
  },
  {
    check: ["javascript"],
    item: (item) => item.startsWith("Links") && item.includes("JavaScript"),
  },
];
/** Items about the near-duplicate check, which Sokosumi does not show. */
const NEAR_DUPLICATE_GAP =
  /^(Near-duplicate pages|Main text of |Text past the first )/;

const urlItems = (urls: string[]): SeoCrawlItem[] =>
  urls.map((label) => ({ label, url: true }));

type Reading =
  | { found: number; items: SeoCrawlItem[]; notDetermined: number }
  | { missing: true; notDetermined?: number };

/** What each check read, or that it read nothing. */
function read(crawl: Crawled, check: SeoCrawlCheck): Reading {
  const { links, pageChecks: pc, orphans, javascript } = crawl;
  const pages = (list: { urls: string[]; total: number } | undefined) =>
    list
      ? {
          found: list.total,
          items: urlItems(list.urls),
          notDetermined: pc ? pc.pages - pc.checked : 0,
        }
      : ({ missing: true } as const);
  switch (check) {
    case "brokenLinks":
      return links
        ? {
            found: links.brokenTotal,
            notDetermined: links.notJudged,
            items: links.broken.map((link) => ({
              label: link.target,
              url: true,
              status: link.status,
              count: link.linkedFrom,
              urls: link.sources,
              ...(link.javascript === "needed" && {
                kind: "javascript" as const,
              }),
            })),
          }
        : { missing: true };
    case "redirectChains":
      return links
        ? {
            found: links.chainsTotal,
            notDetermined: 0,
            items: links.chains.map((chain) => ({
              label: chain.start,
              url: true,
              count: chain.linkedFrom,
              ...(chain.kind !== "chain" && { kind: chain.kind }),
              urls: chainUrls(chain),
            })),
          }
        : { missing: true };
    case "missingTitle":
      return pages(pc?.missingTitle);
    case "missingH1":
      return pages(pc?.missingH1);
    case "duplicateTitles":
      return pc
        ? {
            found: pc.duplicateTitles.total,
            // Pages left out of the title checks are in no comparison either.
            notDetermined:
              pc.duplicateTitles.notDetermined + pc.pages - pc.checked,
            items: pc.duplicateTitles.groups.map((group) => ({
              label: group.text,
              url: false,
              count: group.size,
              urls: group.urls,
            })),
          }
        : { missing: true };
    case "noindexInSitemap":
      return noindex(pc);
    case "badCanonicals":
      return pc
        ? {
            found: pc.badCanonicals.total,
            notDetermined: pc.badCanonicals.notDetermined,
            items: pc.badCanonicals.pages.map((page) => ({
              label: page.url,
              url: true,
              status: page.status,
              kind: page.kind,
              urls: page.canonical ? [page.canonical] : [],
            })),
          }
        : { missing: true };
    case "orphans":
      return orphans?.state === "found"
        ? {
            found: orphans.total,
            notDetermined: 0,
            items: urlItems(orphans.urls),
          }
        : { missing: true };
    case "javascript": {
      if (!javascript) return { missing: true };
      const needs = javascript.groups.filter(
        (group) => group.state === "needs javascript",
      );
      return {
        found: needs.length,
        // Pages whose links the crawl did not see, or the shell pages of the groups it could not decide.
        notDetermined:
          javascript.unseen ||
          javascript.groups
            .filter((group) => group.state === "not determined")
            .reduce((sum, group) => sum + group.shellPages, 0),
        items: needs.map((group) => ({
          label: group.group,
          url: true,
          count: group.shellPages,
        })),
      };
    }
  }
}

/** A chain's hops after its start, and the URL it ends on when the crawl did not fetch that one. */
function chainUrls(chain: NonNullable<Crawled["links"]>["chains"][number]) {
  const hops = chain.hops.map((hop) => hop.url);
  if (chain.final && chain.final !== hops.at(-1)) hops.push(chain.final);
  return hops.slice(1);
}

function noindex(pc: PageChecks | null): Reading {
  const list = pc?.noindexInSitemap;
  if (!list) return { missing: true };
  return {
    found: list.total,
    items: urlItems(list.urls),
    notDetermined: list.sitemapUrls - list.checked,
  };
}

/** The bot's own reasons a check stays undecided: its gap items, a group's or the orphans' reason. */
function reasonsFor(crawl: Crawled, check: SeoCrawlCheck) {
  const reasons = crawl.gaps.flatMap((gap) =>
    GAP_CHECKS.some((g) => g.check.includes(check) && g.item(gap.item))
      ? [gap.reason]
      : [],
  );
  if (check === "orphans" && crawl.orphans?.state === "not determined")
    reasons.unshift(crawl.orphans.reason);
  if (check === "javascript")
    for (const group of crawl.javascript?.groups ?? [])
      if (group.state === "not determined" && group.reason)
        reasons.push(`${group.group}: ${group.reason}`);
  // The orphans' own reason often repeats its gap item with more words: keep the longer one.
  return [...new Set(reasons)].filter(
    (reason) =>
      !reasons.some((other) => other !== reason && other.startsWith(reason)),
  );
}

function emptyReason(crawl: Crawled, check: SeoCrawlCheck): SeoCrawlEmpty {
  // The page checks ran and read no sitemap URL of this site.
  if (check === "noindexInSitemap" && crawl.pageChecks) return "noSitemapPage";
  // A report from before the crawl's JavaScript reads.
  if (check === "javascript" && !crawl.javascript) return "olderReport";
  return "missing";
}

/**
 * The site crawl as a ledger: each check found problems, could not decide, or found none.
 * A check stays "not determined" whenever the crawl left entries out and found nothing: an empty list is no pass.
 */
export function seoSiteCrawlView(
  crawl: ProjectSeoSiteCrawl | undefined,
): SeoCrawlView | null {
  if (!crawl) return null;
  if (crawl.state === "not crawled") return crawl;
  const rows = SEO_CRAWL_CHECKS.map((check): SeoCrawlRow => {
    const reading = read(crawl, check);
    const reasons = reasonsFor(crawl, check);
    if ("found" in reading && reading.found > 0)
      return {
        check,
        state: "found",
        severity: MAJOR.has(check) ? "major" : "minor",
        total: reading.found,
        items: reading.items,
        notDetermined: reading.notDetermined,
        reasons,
        ...(check === "orphans" &&
          crawl.orphans?.state === "found" && {
            candidates: crawl.orphans.candidates,
          }),
      };
    const left = "found" in reading ? reading.notDetermined : 0;
    if ("missing" in reading || left > 0 || reasons.length > 0)
      return {
        check,
        state: "not determined",
        reasons,
        notDetermined: left,
        empty: emptyReason(crawl, check),
      };
    return { check, state: "clear" };
  });
  const found = rows.filter((row) => row.state === "found");
  return {
    state: "crawled",
    read: crawl.read,
    stop: crawl.stop,
    rows: [
      ...found.filter((row) => row.severity === "major"),
      ...found.filter((row) => row.severity === "minor"),
      ...rows.filter((row) => row.state === "not determined"),
    ],
    clear: rows.flatMap((row) => (row.state === "clear" ? [row.check] : [])),
    otherGaps: crawl.gaps.filter(
      (gap) =>
        !GAP_CHECKS.some((g) => g.item(gap.item)) &&
        !NEAR_DUPLICATE_GAP.test(gap.item),
    ),
  };
}
