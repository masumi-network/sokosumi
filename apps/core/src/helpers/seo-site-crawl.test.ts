import { describe, expect, it } from "vitest";
import { legacyReport } from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";

const SITE = "https://example.test";
const list = (urls: string[], total = urls.length) => ({
  pages: urls.map((url) => ({ url })),
  total,
});
const none = list([]);

/** A SiteReport crawl section as the SEO bot writes it, with fields Sokosumi does not keep. */
const botCrawl = () => ({
  snapshotId: "a".repeat(64),
  crawl: {
    fetched: 412,
    read: 388,
    statuses: { "2xx": 371, "3xx": 29, "4xx": 9, "5xx": 1, wall: 0, error: 2 },
    sitemapSeeds: 120,
    chunks: 3,
    stop: "page cap",
    skipped: { robots: 0, depth: 0, template: 0, links: 0 },
  },
  links: {
    broken: [
      {
        target: `${SITE}/pricing/old-plan`,
        status: 404,
        linkedFrom: 14,
        sources: [`${SITE}/`, `${SITE}/pricing`],
        anchors: ["Old plan"],
      },
    ],
    brokenTotal: 9,
    chains: [
      {
        start: `${SITE}/old`,
        kind: "chain",
        hops: [
          { url: `${SITE}/old`, status: 301 },
          { url: `${SITE}/new`, status: 301 },
          { url: `${SITE}/pricing`, status: 200 },
        ],
        redirects: 2,
        final: `${SITE}/pricing`,
        linkedFrom: 3,
      },
    ],
    chainsTotal: 5,
    redirectedLinks: 40,
  },
  orphans: {
    state: "not determined",
    reason: "the crawl stopped at the page limit",
  },
  javascript: {
    state: "incomplete",
    shellPages: 3,
    renders: 1,
    rendered: 1,
    groups: [
      {
        group: "/app/*",
        sample: `${SITE}/app/a`,
        state: "needs javascript",
        links: true,
        text: true,
        shellPages: 3,
        rendered: 1,
        failed: 0,
        notRendered: 2,
      },
    ],
    unseen: 2,
    reasons: [],
  },
  pageChecks: {
    pages: 388,
    checked: 380,
    notDetermined: 2,
    missingTitle: list([`${SITE}/docs/setup`], 2),
    missingDescription: list([`${SITE}/docs/setup`]),
    missingH1: list([`${SITE}/docs/faq`], 4),
    duplicatesLeftOut: 0,
    duplicatesNotDetermined: 1,
    duplicatesNotCompared: 1,
    duplicateTitles: {
      compared: 380,
      groups: [
        {
          text: "Pricing | Example",
          size: 4,
          pages: [{ url: `${SITE}/pricing` }, { url: `${SITE}/pricing/a` }],
        },
      ],
      groupsTotal: 3,
    },
    duplicateDescriptions: { compared: 380, groups: [], groupsTotal: 0 },
    sitemap: {
      urls: 120,
      read: 110,
      checked: 108,
      canonicalChecked: 108,
      noindex: {
        pages: [{ url: `${SITE}/draft`, from: ["html"] }],
        total: 1,
      },
      canonicalElsewhere: none,
    },
    canonicals: {
      elsewhere: 3,
      targetNot2xx: {
        pages: [{ url: `${SITE}/a`, canonical: `${SITE}/gone`, status: 404 }],
        total: 1,
      },
      otherHost: {
        pages: [{ url: `${SITE}/b`, canonical: "https://other.test/b" }],
        total: 2,
      },
      conflicting: none,
      changedInRender: none,
      removedInRender: none,
      targetNotRead: list([`${SITE}/c`]),
      unreadable: none,
      unresolved: none,
    },
  },
});

const siteReport = (more: Record<string, unknown>) => ({
  kind: "site",
  rulebookVersion: "v",
  pages: [legacyReport()],
  couldNotSee: [
    { item: "Market research", reason: "no keyword data" },
    {
      item: "Site crawl: Orphan pages",
      reason: "the crawl stopped at the page limit",
    },
  ],
  ...more,
});

/** Parse as the import does, then read the stored row back. */
const stored = (raw: unknown) =>
  publicSeoPayloadSchema.parse(
    JSON.parse(JSON.stringify(parsePublicSeoArtifact(raw))),
  ).siteCrawl;

describe("imported site crawl", () => {
  it("keeps what the crawl found, the totals past each list, and only the crawl's own gaps", () => {
    const crawl = stored(siteReport({ crawl: botCrawl() }));
    expect(crawl?.state).toBe("crawled");
    if (crawl?.state !== "crawled") return;
    expect(crawl).toMatchObject({ fetched: 412, read: 388, stop: "page cap" });
    expect(crawl.links).toMatchObject({
      brokenTotal: 9,
      chainsTotal: 5,
      notJudged: 0,
    });
    expect(crawl.orphans).toEqual({
      state: "not determined",
      reason: "the crawl stopped at the page limit",
    });
    expect(crawl.pageChecks?.missingH1).toEqual({
      urls: [`${SITE}/docs/faq`],
      total: 4,
    });
    expect(crawl.pageChecks?.duplicateTitles).toEqual({
      groups: [
        {
          text: "Pricing | Example",
          size: 4,
          urls: [`${SITE}/pricing`, `${SITE}/pricing/a`],
        },
      ],
      total: 3,
      // An unresolved canonical, and a text the bot does not compare.
      notDetermined: 2,
    });
    expect(crawl.pageChecks?.noindexInSitemap).toEqual({
      urls: [`${SITE}/draft`],
      total: 1,
      sitemapUrls: 120,
      checked: 108,
    });
    // A canonical the crawl did not read, or a page with no head, is not determined: never a bad one, never a pass.
    expect(crawl.pageChecks?.badCanonicals).toEqual({
      pages: [
        {
          kind: "target not 2xx",
          url: `${SITE}/a`,
          canonical: `${SITE}/gone`,
          status: 404,
        },
        {
          kind: "other host",
          url: `${SITE}/b`,
          canonical: "https://other.test/b",
          status: null,
        },
      ],
      total: 3,
      notDetermined: 3,
    });
    expect(crawl.gaps).toEqual([
      { item: "Orphan pages", reason: "the crawl stopped at the page limit" },
    ]);
  });

  it("keeps the crawl when one gap is longer than Sokosumi stores", () => {
    // The bot joins the URLs of unread page audits into one reason.
    const urls = Array.from(
      { length: 4 },
      (_, i) => `${SITE}/${"a".repeat(480)}${i}`,
    );
    const crawl = stored(
      siteReport({
        crawl: botCrawl(),
        couldNotSee: [
          {
            item: "Site crawl: 4 URLs of the page audits that the crawl did not fetch again",
            reason: `the page audit's own read gave no response: ${urls.join(", ")}`,
          },
        ],
      }),
    );
    expect(crawl?.state).toBe("crawled");
    if (crawl?.state !== "crawled") return;
    expect(crawl.gaps[0]?.reason).toHaveLength(2000);
    expect(crawl.gaps[0]?.reason.endsWith("…")).toBe(true);
  });

  it("keeps why a site audit has no crawl", () => {
    expect(
      stored(
        siteReport({
          couldNotSee: [
            {
              item: "Site crawl",
              reason: "robots.txt keeps the crawl out",
            },
          ],
        }),
      ),
    ).toEqual({
      state: "not crawled",
      reason: "robots.txt keeps the crawl out",
    });
  });

  it("has no crawl when the owner asked for none, or the report is from before the crawl", () => {
    const notAsked = siteReport({
      request: { crawl: false },
      couldNotSee: [
        { item: "Site crawl", reason: "the Request asked for no site crawl" },
      ],
    });
    expect(stored(notAsked)).toBeUndefined();
    expect(stored(siteReport({}))).toBeUndefined();
  });

  it("still imports the report when its crawl section does not match", () => {
    const raw = siteReport({ crawl: { ...botCrawl(), crawl: { read: -1 } } });
    expect(parsePublicSeoArtifact(raw).pageUrls).toHaveLength(1);
    expect(stored(raw)).toBeUndefined();
  });

  it("keeps a stored row readable when its crawl no longer matches", () => {
    const row = JSON.parse(
      JSON.stringify(parsePublicSeoArtifact(siteReport({ crawl: botCrawl() }))),
    );
    row.siteCrawl.stop = "a stop Sokosumi does not know";
    expect(publicSeoPayloadSchema.parse(row).siteCrawl).toBeUndefined();
  });
});
