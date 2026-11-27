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
      // The pages left out of the title checks, compared with none.
      duplicateTitles: 8,
      // A linked URL with no answer may start a chain.
      redirectChains: 3,
    });
    expect(result.clear).toEqual(["orphans", "javascript"]);
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
      empty: "noSitemapPage",
    });
    expect(result.otherGaps).toEqual([]);
  });

  it("says a check is missing when the report has no page checks at all", () => {
    const crawl = cleanCrawl();
    crawl.pageChecks = null;
    expect(row(crawl, "noindexInSitemap")).toMatchObject({ empty: "missing" });
  });

  it("does not pass link and sitemap checks the crawl could not finish", () => {
    const crawl = cleanCrawl();
    crawl.stop = "page cap";
    crawl.gaps = [
      { item: "Pages past where the crawl stopped", reason: "the page cap" },
      { item: "Some sitemap URLs", reason: "a sitemap read failed" },
    ];
    const result = view(crawl);
    expect(row(crawl, "brokenLinks")).toMatchObject({
      state: "not determined",
      reasons: ["the page cap"],
    });
    expect(row(crawl, "redirectChains")).toMatchObject({
      reasons: ["the page cap"],
    });
    expect(row(crawl, "orphans")).toMatchObject({
      reasons: ["a sitemap read failed"],
    });
    expect(row(crawl, "noindexInSitemap")).toMatchObject({
      reasons: ["a sitemap read failed"],
    });
    expect(result.otherGaps).toEqual([]);
  });

  it("passes no check over the read pages of a stopped crawl that gave no gap item", () => {
    const crawl = cleanCrawl();
    crawl.stop = "time";
    const result = view(crawl);
    expect(result.clear).toEqual(["noindexInSitemap", "orphans"]);
    for (const check of [
      "brokenLinks",
      "redirectChains",
      "missingTitle",
      "missingH1",
      "duplicateTitles",
      "badCanonicals",
      "javascript",
    ] as const)
      expect(row(crawl, check)).toMatchObject({
        state: "not determined",
        empty: "stopped",
      });
  });

  it("gives the stop reason to the page checks of a stopped crawl", () => {
    const crawl = cleanCrawl();
    crawl.stop = "page cap";
    crawl.gaps = [
      {
        item: "Pages past where the crawl stopped",
        reason: "the crawl reached its limit of 500 pages",
      },
    ];
    expect(row(crawl, "missingTitle")).toMatchObject({
      reasons: ["the crawl reached its limit of 500 pages"],
    });
    expect(view(crawl).otherGaps).toEqual([]);
  });

  it.each([
    "1 URL the robots file blocks",
    "Links and text that JavaScript adds to 1 shell page",
    "1 URL that gave no response",
    "1 URL of the page audits that the crawl did not fetch again",
  ])(
    "does not pass the link checks of a complete crawl with the gap %s",
    (item) => {
      const crawl = cleanCrawl();
      crawl.gaps = [{ item, reason: "the crawl could not see it" }];
      const result = view(crawl);
      expect(result.clear).not.toContain("brokenLinks");
      expect(result.clear).not.toContain("redirectChains");
      expect(result.otherGaps).toEqual([]);
    },
  );

  it("keeps the duplicate check undecided when the bot did not compare some texts", () => {
    const crawl = cleanCrawl();
    crawl.gaps = [{ item: "Duplicate titles", reason: "1 page not compared" }];
    expect(row(crawl, "duplicateTitles")).toMatchObject({
      state: "not determined",
      reasons: ["1 page not compared"],
    });
  });

  it("passes no check when Core stored only part of the crawl's gaps", () => {
    const crawl = cleanCrawl();
    crawl.gaps = [{ item: "More gaps", reason: "11 more gaps" }];
    const result = view(crawl);
    expect(result.clear).toEqual([]);
    expect(result.otherGaps).toEqual([]);
    expect(row(crawl, "noindexInSitemap")).toMatchObject({
      state: "not determined",
      reasons: ["11 more gaps"],
    });
  });

  it("passes page groups the crawl rendered, with the caveat about other pages shown apart", () => {
    const crawl = cleanCrawl();
    const caveat = {
      item: "Links and text that only JavaScript adds to a page whose raw HTML is not a shell",
      reason: "the crawl renders a page only when its raw HTML is a shell",
    };
    crawl.gaps = [caveat];
    const result = view(crawl);
    expect(result.clear).toContain("javascript");
    expect(result.otherGaps).toEqual([caveat]);
  });

  it("keeps the stop reason off what a stopped crawl found", () => {
    const crawl = cleanCrawl();
    crawl.stop = "page cap";
    crawl.pageChecks!.missingTitle = { urls: [`${SITE}/a`], total: 1 };
    crawl.gaps = [
      { item: "Pages past where the crawl stopped", reason: "the page cap" },
    ];
    expect(row(crawl, "missingTitle")).toMatchObject({
      state: "found",
      reasons: [],
    });
    expect(row(crawl, "missingH1")).toMatchObject({
      reasons: ["the page cap"],
    });
  });

  it("keeps the bot's reasons on a check that found problems", () => {
    const crawl = cleanCrawl();
    crawl.pageChecks!.noindexInSitemap = {
      urls: [`${SITE}/draft`],
      total: 1,
      sitemapUrls: 1,
      checked: 1,
    };
    crawl.gaps = [
      { item: "Some sitemap URLs", reason: "a sitemap read failed" },
    ];
    expect(row(crawl, "noindexInSitemap")).toMatchObject({
      state: "found",
      reasons: ["a sitemap read failed"],
    });
  });

  it("ends a redirect chain on its final URL when the crawl did not fetch it", () => {
    const crawl = cleanCrawl();
    crawl.links!.chains = [
      {
        start: `${SITE}/a`,
        kind: "chain",
        hops: [
          { url: `${SITE}/a`, status: 301 },
          { url: `${SITE}/b`, status: 301 },
        ],
        final: "https://other.test/c",
        linkedFrom: 1,
      },
    ];
    crawl.links!.chainsTotal = 1;
    const found = row(crawl, "redirectChains");
    expect(found?.state === "found" && found.items[0]?.urls).toEqual([
      `${SITE}/b`,
      "https://other.test/c",
    ]);
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
      { item: `robots.txt of ${SITE}`, reason: "it did not load" },
    ];
    const result = view(crawl);
    expect(result.otherGaps).toEqual([
      { item: `robots.txt of ${SITE}`, reason: "it did not load" },
    ]);
    expect(row(crawl, "javascript")).toMatchObject({ reasons: ["no render"] });
    // A crawl that ran no script may have missed a link to a broken URL or a chain.
    for (const check of ["brokenLinks", "redirectChains"] as const)
      expect(row(crawl, check)).toMatchObject({
        state: "not determined",
        reasons: ["no render"],
      });
  });

  it("clears no check of what a script sets on a page the crawl read as raw HTML", () => {
    const crawl = cleanCrawl();
    crawl.gaps = [
      { item: "Pages with a script read as raw HTML", reason: "no script ran" },
    ];
    crawl.links!.broken = [
      { target: `${SITE}/old`, status: 404, linkedFrom: 3, sources: [] },
    ];
    crawl.links!.brokenTotal = 1;
    const result = view(crawl);
    expect([...result.clear].sort()).toEqual(
      ["javascript", "missingH1", "missingTitle", "orphans"].sort(),
    );
    expect(result.otherGaps).toEqual([]);
    // A problem the crawl found still shows.
    expect(row(crawl, "brokenLinks")).toMatchObject({ state: "found" });
  });

  it("finds a sitemap URL that only nofollow links reach, as Google follows none of them", () => {
    const crawl = cleanCrawl();
    crawl.orphans = {
      state: "found",
      urls: [`${SITE}/lost`],
      total: 1,
      nofollowOnly: { urls: [`${SITE}/hidden`], total: 2 },
      candidates: false,
    };
    expect(row(crawl, "orphans")).toMatchObject({
      state: "found",
      total: 3,
      items: [
        { label: `${SITE}/lost`, url: true },
        { label: `${SITE}/hidden`, url: true, kind: "nofollow only" },
      ],
    });
  });

  it("keeps why a site was not crawled, and shows nothing for a report without a crawl", () => {
    expect(
      seoSiteCrawlView({ state: "not crawled", reason: "robots.txt" }),
    ).toEqual({ state: "not crawled", reason: "robots.txt" });
    expect(seoSiteCrawlView(undefined)).toBeNull();
  });
});
