import type { ProjectSeoSiteCrawl } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoSiteCrawlView } from "./seo-site-crawl-model";

type Crawled = Extract<ProjectSeoSiteCrawl, { state: "crawled" }>;
const SITE = "https://example.test";
const none = { urls: [], total: 0 };

/** A crawl that read every page and found nothing: each check passes. */
const cleanCrawl = (): Crawled => ({
  state: "crawled",
  fetched: 40,
  read: 38,
  stop: "complete",
  links: {
    broken: [],
    brokenTotal: 0,
    chains: [],
    chainsTotal: 0,
    notJudged: 0,
  },
  javascript: { unseen: 0, groups: [] },
  orphans: { state: "found", urls: [], total: 0, candidates: false },
  pageChecks: {
    pages: 38,
    checked: 38,
    missingTitle: none,
    missingH1: none,
    duplicateTitles: { groups: [], total: 0, notDetermined: 0 },
    noindexInSitemap: { ...none, sitemapUrls: 20, checked: 20 },
    badCanonicals: { pages: [], total: 0, notDetermined: 0 },
  },
  gaps: [],
});

const view = (crawl: ProjectSeoSiteCrawl | undefined) => {
  const result = seoSiteCrawlView(crawl);
  if (result?.state !== "crawled") throw new Error("expected a crawl");
  return result;
};
const row = (crawl: Crawled, check: string) =>
  view(crawl).rows.find((r) => r.check === check);

describe("site crawl ledger", () => {
  it("lists major problems before minor ones, then the undecided checks, and folds the rest into passes", () => {
    const crawl = cleanCrawl();
    crawl.pageChecks!.missingH1 = { urls: [`${SITE}/faq`], total: 4 };
    crawl.links!.broken = [
      { target: `${SITE}/old`, status: 404, linkedFrom: 3, sources: [] },
    ];
    crawl.links!.brokenTotal = 9;
    crawl.orphans = { state: "not determined", reason: "the crawl stopped" };
    const result = view(crawl);
    expect(result.rows.map((r) => [r.check, r.state])).toEqual([
      ["brokenLinks", "found"],
      ["missingH1", "found"],
      ["orphans", "not determined"],
    ]);
    expect(result.rows[0]).toMatchObject({ severity: "major", total: 9 });
    expect(result.rows[1]).toMatchObject({ severity: "minor", total: 4 });
    expect(result.rows[2]).toMatchObject({ reasons: ["the crawl stopped"] });
    expect(result.clear).not.toContain("orphans");
    expect(result.clear).toContain("badCanonicals");
  });

  it("never passes a check that found nothing but left entries out", () => {
    const crawl = cleanCrawl();
    crawl.links!.notJudged = 3;
    crawl.pageChecks!.checked = 30;
    crawl.pageChecks!.noindexInSitemap = {
      ...none,
      sitemapUrls: 20,
      checked: 12,
    };
    crawl.pageChecks!.badCanonicals.notDetermined = 2;
    const result = view(crawl);
    expect(
      Object.fromEntries(
        result.rows.map((r) => [
          r.check,
          r.state === "not determined" ? r.notDetermined : r.state,
        ]),
      ),
    ).toEqual({
      brokenLinks: 3,
      noindexInSitemap: 8,
      badCanonicals: 2,
      missingTitle: 8,
      missingH1: 8,
    });
    expect(result.clear).toEqual([
      "redirectChains",
      "duplicateTitles",
      "orphans",
      "javascript",
    ]);
  });

  it("keeps a check without a section undecided, with the bot's reasons for it", () => {
    const crawl = cleanCrawl();
    crawl.links = null;
    crawl.orphans = null;
    crawl.pageChecks!.noindexInSitemap = null;
    crawl.gaps = [
      { item: "Broken internal links", reason: "no HTML page was read" },
      { item: "Orphan pages", reason: "the sitemap could not be read" },
    ];
    const result = view(crawl);
    expect(row(crawl, "brokenLinks")).toMatchObject({
      state: "not determined",
      reasons: ["no HTML page was read"],
    });
    expect(row(crawl, "redirectChains")).toMatchObject({
      reasons: ["no HTML page was read"],
    });
    expect(row(crawl, "orphans")).toMatchObject({
      reasons: ["the sitemap could not be read"],
    });
    // No gap names the sitemap check: the row is still undecided, and the view says why from the empty section.
    expect(row(crawl, "noindexInSitemap")).toEqual({
      check: "noindexInSitemap",
      state: "not determined",
      reasons: [],
      notDetermined: 0,
    });
    expect(result.otherGaps).toEqual([]);
  });

  it("counts the shell pages of a JavaScript group it could not decide", () => {
    const crawl = cleanCrawl();
    crawl.javascript = {
      unseen: 0,
      groups: [
        { group: "/app/*", state: "not determined", shellPages: 6 },
        { group: "/docs/*", state: "no difference", shellPages: 2 },
      ],
    };
    expect(row(crawl, "javascript")).toMatchObject({
      state: "not determined",
      notDetermined: 6,
    });
  });

  it("shows only the gaps no check names, without the near-duplicate check Sokosumi does not show", () => {
    const crawl = cleanCrawl();
    crawl.gaps = [
      { item: "Links that only JavaScript adds", reason: "no render" },
      { item: "Near-duplicate pages", reason: "too few pages" },
      { item: "Main text of 3 pages", reason: "too long" },
      { item: "4 URLs that gave no response", reason: "timeouts" },
    ];
    const result = view(crawl);
    expect(result.otherGaps).toEqual([
      { item: "4 URLs that gave no response", reason: "timeouts" },
    ]);
    expect(row(crawl, "javascript")).toMatchObject({ reasons: ["no render"] });
  });

  it("keeps why a site was not crawled, and shows nothing for a report without a crawl", () => {
    expect(
      seoSiteCrawlView({ state: "not crawled", reason: "robots.txt" }),
    ).toEqual({ state: "not crawled", reason: "robots.txt" });
    expect(seoSiteCrawlView(undefined)).toBeNull();
  });
});
