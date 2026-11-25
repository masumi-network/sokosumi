import { describe, expect, it } from "vitest";
import { legacyReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import { readSiteSpeed, scopedSiteSpeed } from "./seo-site-speed";

const EXTRA = "https://example.test/pricing";
const median = { lcp: 2400, fcp: 1200, cls: 0, si: 3600, tbt: 180 };
const lab = (url: string, device: string) => ({
  runs: 1,
  ok: 1,
  median,
  lighthouse: "13.6.0",
  sourceRefs: [
    {
      record: "c".repeat(64),
      port: "psi",
      request: { port: "psi", url, device },
      outcome: { kind: "ok", status: 200 },
    },
  ],
});
const section = (url: string, labUrl = url, labDevice = "mobile") => ({
  mobile: {
    lab: lab(labUrl, labDevice),
    field: { none: "no CrUX data for the URL, origin: no data" },
  },
  desktop: {
    lab: { none: "Time budget expired" },
    field: { none: "no CrUX data for the URL, origin: no data" },
  },
});
const extra = (url: string, more: object = {}) => ({
  url,
  n: null,
  source: "search-console",
  clicks: 120,
  group: "/pricing",
  speed: section(url),
  ...more,
});
const check = {
  device: "mobile",
  basis: "crux-url",
  mix: {
    level: "url",
    phone: 0.62,
    desktop: 0.35,
    tablet: 0.03,
    period: { first: "2026-10-01", last: "2026-10-28" },
    record: "a".repeat(64),
  },
  notChecked: null,
};
const site = (pages: unknown[], more: object = {}) => ({
  kind: "site",
  rulebookVersion: "v",
  pages: [{ ...legacyReport(), speed: section(SEO_TEST_PAGE) }],
  speed: { pages, note: "Search Console named 3 pages", ...more },
});
const read = (pages: unknown[], more: object = {}) =>
  readSiteSpeed(site(pages, more), [SEO_TEST_PAGE], []);

describe("a site Report's speed table", () => {
  it("drops a foreign host and a query URL, counts them, and still imports the audit", () => {
    const result = parsePublicSeoArtifact(
      site([
        extra(EXTRA),
        extra("https://evil.test/pricing"),
        extra("https://example.test/pricing?utm=1"),
      ]),
    );
    expect(result.siteSpeed?.dropped).toBe(2);
    expect(result.siteSpeed?.rows.map((row) => row.url)).toEqual([EXTRA]);
    expect(result.siteSpeed?.rows[0]?.devices[0]).toMatchObject({
      pageUrl: EXTRA,
      device: "mobile",
      lab: { status: "measured", median },
    });
  });

  it("refuses a lab sample of another URL or device on an extra page", () => {
    for (const speed of [
      section(EXTRA, "https://example.test/other"),
      section(EXTRA, EXTRA, "desktop"),
    ])
      expect(read([extra(EXTRA, { speed })])?.rows[0]?.devices[0]?.lab).toEqual(
        { status: "unavailable" },
      );
  });

  it("stores no devices for an audited page and does not trust the worker's page number", () => {
    const table = read([
      { ...extra(SEO_TEST_PAGE), n: null, source: "links" },
      extra(EXTRA, { n: 3, source: "audited" }),
    ]);
    expect(table?.rows).toMatchObject([
      { url: SEO_TEST_PAGE, audited: true, devices: [] },
      { url: EXTRA, audited: false },
    ]);
    expect(table?.rows[1]?.devices).toHaveLength(2);
  });

  it("omits unsafe or unknown row text and keeps the row", () => {
    const rows = read([
      extra(EXTRA, {
        why: "Ask private@example.com about this page",
        cause: "hunch",
        tier: "max",
        group: "pricing?x=1",
      }),
      extra("https://example.test/long", { why: "a".repeat(201) }),
      extra("https://example.test/ok", {
        why: "  The page sells the main plan.  ",
        cause: "entry",
        tier: "full",
      }),
    ])?.rows;
    expect(rows).toHaveLength(3);
    for (const row of rows!.slice(0, 2)) expect(row).not.toHaveProperty("why");
    for (const key of ["cause", "tier", "group"])
      expect(rows![0]).not.toHaveProperty(key);
    expect(rows![2]).toMatchObject({
      why: "The page sells the main plan.",
      cause: "entry",
      tier: "full",
      group: "/pricing",
    });
  });

  it("stores no Search Console fact and no worker free text of the table", () => {
    const stored = JSON.stringify(
      read([extra(EXTRA, { tier: "reduced", check })], {
        notChecked: {
          count: 1,
          reason: "The owner's Search Console named more pages",
          pages: [{ url: "https://example.test/left", source: "sitemap" }],
        },
      }),
    );
    expect(stored).toContain(EXTRA);
    for (const word of ["clicks", "source", "search-console", "Search Console"])
      expect(stored).not.toContain(word);
    expect(stored).not.toContain("https://example.test/left");
    expect(stored).not.toContain("a".repeat(64));
    expect(JSON.parse(stored).notChecked).toEqual({
      count: 1,
      reason: "other",
    });
  });

  it("keeps how a reduced page was read, with a code for the reason", () => {
    const row = (more: object, tier = "reduced") =>
      read([extra(EXTRA, { tier, check: { ...check, ...more } })])?.rows[0];
    const { record: _record, ...mix } = check.mix;
    expect(row({})?.check).toEqual({ ...check, mix, notChecked: null });
    expect(
      ["time limit", "CrUX rate limit", "something new"].map(
        (notChecked) => row({ notChecked, mix: null })?.check?.notChecked,
      ),
    ).toEqual(["deadline", "quota", "other"]);
    // A share is a fraction. A check Core cannot read goes; the row stays.
    for (const bad of [
      row({ mix: { ...check.mix, phone: 62 } }),
      row({ device: "tablet" }),
      row({}, "full"),
    ])
      expect([bad?.url, bad && "check" in bad]).toEqual([EXTRA, false]);
  });

  it("maps the worker's sentence for pages it left out to a code", () => {
    const reason = (text: unknown, count: unknown = 4) =>
      read([], { notChecked: { count, reason: text, pages: [] } })?.notChecked
        ?.reason;
    expect(
      [
        "the audit tests up to 40 pages",
        "page limit reached",
        "time limit reached",
        "CrUX rate limit",
        "Google quota used up",
        "private@example.com asked",
        null,
      ].map((text) => reason(text)),
    ).toEqual([
      "limit",
      "limit",
      "deadline",
      "quota",
      "quota",
      "other",
      "other",
    ]);
    expect(reason("time limit", -1)).toBeUndefined();
    expect(reason("time limit", "4")).toBeUndefined();
  });

  it("caps the table at 40 pages and keeps a repeated page once", () => {
    const many = read(
      Array.from({ length: 45 }, (_, i) =>
        extra(`https://example.test/p${i}`, { speed: null }),
      ),
    );
    expect([many?.rows.length, many?.dropped]).toEqual([40, 5]);
    const twice = read([extra(EXTRA), extra(EXTRA)]);
    expect([twice?.rows.length, twice?.dropped]).toEqual([1, 1]);
  });

  it("reads no table from a Report without one, and one bad stored table does not break the audit", () => {
    const { speed: _speed, ...old } = site([]);
    const result = parsePublicSeoArtifact(old);
    expect(result.siteSpeed).toBeUndefined();
    const stored = publicSeoPayloadSchema.parse({
      ...JSON.parse(JSON.stringify(result)),
      siteSpeed: { rows: [{ url: "not a url" }], dropped: -1 },
    });
    expect(stored.siteSpeed).toBeUndefined();
    expect(stored.pageSpeed).toHaveLength(2);
  });

  it("survives a speed section that is not what the worker writes", () => {
    for (const pages of [
      [null, 7, "x", []],
      [{ url: 5 }],
      [extra(EXTRA, { speed: 9 })],
    ])
      expect(() => parsePublicSeoArtifact(site(pages))).not.toThrow();
    expect(parsePublicSeoArtifact({ ...site([]), speed: "x" }).siteSpeed).toBe(
      undefined,
    );
  });
});

describe("the speed table in a workspace view", () => {
  const stored = parsePublicSeoArtifact(
    site([extra(SEO_TEST_PAGE, { speed: null }), extra(EXTRA)]),
  );
  const row = { id: "o1", observedAt: new Date("2026-11-01T00:00:00Z") };

  it("fills an audited page's devices from the same audit's page speed", () => {
    const table = scopedSiteSpeed(stored, row, new Set([SEO_TEST_PAGE]));
    expect(table).toMatchObject({
      observationId: "o1",
      observedAt: "2026-11-01T00:00:00.000Z",
      dropped: 0,
    });
    expect(table?.rows[0]?.devices).toEqual(stored.pageSpeed);
    expect(table?.rows[1]?.devices).toHaveLength(2);
  });

  it("gives no table to a view that lacks an audited page", () => {
    expect(scopedSiteSpeed(stored, row, new Set([EXTRA]))).toBeNull();
  });
});
