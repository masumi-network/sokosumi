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
      notDetermined: 1,
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
    // The bot's not-compared count mixes titles and descriptions: it is words, never a count of titles.
    expect(crawl.gaps).toEqual([
      {
        item: "Duplicate titles",
        reason:
          "the check does not compare the title or the meta description of 1 page: the text holds too many combining marks in a row",
      },
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
    expect(crawl.gaps[1]?.reason).toHaveLength(2000);
    expect(crawl.gaps[1]?.reason.endsWith("…")).toBe(true);
  });

  it("says so when the crawl gave more gaps than Sokosumi stores", () => {
    const crawl = stored(
      siteReport({
        crawl: botCrawl(),
        couldNotSee: Array.from({ length: 60 }, (_, i) => ({
          item: `Site crawl: Gap ${i}`,
          reason: "not read",
        })),
      }),
    );
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    expect(crawl.gaps).toHaveLength(50);
    // The duplicate check's own gap comes first: 61 gaps, of which 49 stay.
    expect(crawl.gaps.at(-2)?.item).toBe("Gap 47");
    expect(crawl.gaps.at(-1)).toEqual({
      item: "More gaps",
      reason:
        "the crawl gave 12 more gaps than Sokosumi stores, so no check can be clear",
    });
  });

  it("keeps the readable gaps of a Report with an unreadable one, and clears no check", () => {
    const crawl = stored(
      siteReport({
        crawl: botCrawl(),
        couldNotSee: [
          { item: "Site crawl: Some sitemap URLs", reason: "not read" },
          // A NUL inside the prefix: storage drops it, so the gap is the crawl's.
          { item: "Site cr\u0000awl: Broken links", reason: "not read" },
          { item: 7 },
          { item: " ", reason: "some link targets could not be read" },
          { item: "Site crawl: ", reason: "some redirects could not be read" },
          {
            item: "Site crawl: \u0000",
            reason: "some redirects could not be read",
          },
        ],
      }),
    );
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    expect(crawl.gaps.slice(-3)).toEqual([
      { item: "Some sitemap URLs", reason: "not read" },
      { item: "Broken links", reason: "not read" },
      {
        item: "More gaps",
        reason:
          "the Report holds 4 gaps Sokosumi cannot read, so no check can be clear",
      },
    ]);
  });

  it("keeps the crawl and its totals when an example has a URL or a text Sokosumi cannot store", () => {
    const long = `${SITE}/${"x".repeat(4096)}`;
    const raw = botCrawl();
    raw.links.broken[0]!.sources.push(long);
    raw.links.broken.push({ ...raw.links.broken[0]!, target: long });
    raw.links.chains.push({
      ...raw.links.chains[0]!,
      hops: [{ url: long, status: 301 }],
    });
    raw.javascript.groups.push({
      ...raw.javascript.groups[0]!,
      group: "g".repeat(3000),
      reason: "r".repeat(3000),
    } as (typeof raw.javascript.groups)[number]);
    raw.pageChecks.missingTitle.pages.push({ url: long });
    raw.pageChecks.duplicateTitles.groups[0]!.text = "t".repeat(3000);
    raw.pageChecks.duplicateTitles.groups[0]!.pages.push({ url: "\u0000" });
    raw.pageChecks.canonicals.otherHost.pages.push(
      { url: `${SITE}/c`, canonical: long },
      { url: long, canonical: `${SITE}/d` },
    );
    const crawl = stored(
      siteReport({
        crawl: {
          ...raw,
          orphans: { state: "found", urls: [long, `${SITE}/lost`], total: 2 },
        },
      }),
    );
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    expect(crawl.links?.broken).toEqual([
      expect.objectContaining({
        target: `${SITE}/pricing/old-plan`,
        sources: [`${SITE}/`, `${SITE}/pricing`],
      }),
    ]);
    expect(crawl.links?.brokenTotal).toBe(9);
    expect(crawl.links?.chains.map((chain) => chain.start)).toEqual([
      `${SITE}/old`,
    ]);
    expect(crawl.pageChecks?.missingTitle).toEqual({
      urls: [`${SITE}/docs/setup`],
      total: 2,
    });
    expect(crawl.pageChecks?.duplicateTitles.groups).toEqual([
      expect.objectContaining({
        text: `${"t".repeat(1999)}…`,
        urls: [`${SITE}/pricing`, `${SITE}/pricing/a`],
      }),
    ]);
    expect(crawl.pageChecks?.badCanonicals.pages.map((row) => row.url)).toEqual(
      [`${SITE}/a`, `${SITE}/b`],
    );
    expect(crawl.orphans).toMatchObject({ urls: [`${SITE}/lost`], total: 2 });
    expect(crawl.javascript?.groups[1]).toMatchObject({
      group: `${"g".repeat(1999)}…`,
      reason: `${"r".repeat(1999)}…`,
    });
    const unknown = stored(
      siteReport({
        crawl: {
          ...botCrawl(),
          orphans: { state: "not determined", reason: "o".repeat(3000) },
        },
      }),
    );
    expect(unknown?.state === "crawled" && unknown.orphans).toEqual({
      state: "not determined",
      reason: `${"o".repeat(1999)}…`,
    });
  });

  it("names no page by a URL the bot cut, and keeps it in the total", () => {
    const cutUrl = { url: `${SITE}/docs`, urlCut: true };
    const raw = botCrawl();
    raw.pageChecks.missingH1.pages.push(cutUrl);
    raw.pageChecks.duplicateTitles.groups[0]!.pages.push(cutUrl);
    raw.pageChecks.canonicals.otherHost.pages.push({
      ...cutUrl,
      canonical: "https://other.test/docs",
    });
    const crawl = stored(siteReport({ crawl: raw }));
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    expect(crawl.pageChecks?.missingH1).toEqual({
      urls: [`${SITE}/docs/faq`],
      total: 4,
    });
    expect(crawl.pageChecks?.duplicateTitles.groups[0]?.urls).toEqual([
      `${SITE}/pricing`,
      `${SITE}/pricing/a`,
    ]);
    expect(crawl.pageChecks?.badCanonicals.pages.map((row) => row.url)).toEqual(
      [`${SITE}/a`, `${SITE}/b`],
    );
    expect(crawl.pageChecks?.badCanonicals.total).toBe(3);
  });

  it("says how many pages with a script the crawl read as raw HTML, so no check of what a script sets is clear", () => {
    const raw = botCrawl();
    raw.pageChecks.checked =
      raw.pageChecks.pages - raw.pageChecks.notDetermined;
    const read = (crawl: unknown) => {
      const result = stored(siteReport({ crawl }));
      if (result?.state !== "crawled") throw new Error("expected a crawl");
      return result.gaps.filter(
        (gap) => gap.item === "Pages with a script read as raw HTML",
      );
    };
    expect(read(raw)).toEqual([]);
    // The page checks and the link checks each count them.
    for (const crawl of [
      { ...raw, pageChecks: { ...raw.pageChecks, scriptPagesRawOnly: 7 } },
      { ...raw, javascript: { ...raw.javascript, scriptPagesRawOnly: 7 } },
    ])
      expect(read(crawl)).toEqual([
        {
          item: "Pages with a script read as raw HTML",
          reason: expect.stringContaining("7 pages"),
        },
      ]);
  });

  it("counts at least the examples a check lists, so a total too low clears no check", () => {
    const raw = botCrawl();
    raw.links.brokenTotal = 0;
    raw.links.chainsTotal = 0;
    raw.pageChecks.missingTitle.total = 0;
    raw.pageChecks.duplicateTitles.groupsTotal = 0;
    const crawl = stored(
      siteReport({
        crawl: {
          ...raw,
          orphans: { state: "found", urls: [`${SITE}/lost`], total: 0 },
        },
      }),
    );
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    expect(crawl.links).toMatchObject({ brokenTotal: 1, chainsTotal: 1 });
    expect(crawl.pageChecks?.missingTitle.total).toBe(
      raw.pageChecks.missingTitle.pages.length,
    );
    expect(crawl.pageChecks?.duplicateTitles.total).toBe(
      raw.pageChecks.duplicateTitles.groups.length,
    );
    expect(crawl.orphans).toMatchObject({ total: 1 });
  });

  it("counts no more pages checked than there are, so a count too high clears no check", () => {
    const raw = botCrawl();
    raw.pageChecks.checked = raw.pageChecks.pages + 3;
    raw.pageChecks.sitemap.checked = raw.pageChecks.sitemap.urls + 3;
    const crawl = stored(siteReport({ crawl: raw }));
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    // A page whose head the bot could not read is in no check either.
    expect(crawl.pageChecks).toMatchObject({
      checked: raw.pageChecks.pages - raw.pageChecks.notDetermined,
      noindexInSitemap: { checked: raw.pageChecks.sitemap.urls },
    });
    // More pages without a head than pages read still keeps the crawl.
    raw.pageChecks.notDetermined = raw.pageChecks.pages + 1;
    const noHead = stored(siteReport({ crawl: raw }));
    expect(noHead?.state === "crawled" && noHead.pageChecks?.checked).toBe(0);
  });

  it("keeps no crawl with a negative count, which would cancel a check's undecided pages", () => {
    const raw = botCrawl();
    expect(raw.pageChecks.canonicals.targetNotRead.total).toBeGreaterThan(0);
    const canonicals = { ...raw.pageChecks.canonicals, notClassified: -1 };
    expect(
      stored(
        siteReport({
          crawl: { ...raw, pageChecks: { ...raw.pageChecks, canonicals } },
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps only text PostgreSQL can store", () => {
    // A cut inside a surrogate pair, and a NUL: jsonb refuses both, and the whole import with them.
    const crawl = stored(
      siteReport({
        crawl: botCrawl(),
        couldNotSee: [
          { item: "Site crawl: Long", reason: `${"a".repeat(1998)}😀!` },
          { item: "Site crawl: Nul", reason: "a\u0000b" },
        ],
      }),
    );
    if (crawl?.state !== "crawled") throw new Error("expected a crawl");
    for (const gap of crawl.gaps) {
      expect(gap.reason.isWellFormed()).toBe(true);
      expect(gap.reason).not.toContain("\u0000");
    }
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
