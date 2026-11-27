import { describe, expect, it } from "vitest";
import { SITE_SPEED_CAUSES } from "@/schemas/seo-site-speed.schema";
import { legacyReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import { readPageSpeed } from "./seo-page-speed";
import { readSiteSpeed, scopedSiteSpeed } from "./seo-site-speed";

const SECRET = ["sk", "live", "51QX9J5eXampleSecretValue123456"].join("_");

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
/** A CrUX URL record of a page on mobile, as the worker writes it. */
const cruxField = (
  url: string,
  p75: Record<string, number | null>,
  more: object = {},
) => ({
  level: "url",
  url,
  period: null,
  p75: { lcp: null, inp: null, cls: null, ttfb: null, fcp: null, ...p75 },
  sourceRefs: [
    {
      port: "crux",
      request: {
        port: "crux",
        device: "mobile",
        url,
        params: { kind: "record", level: "url" },
      },
      outcome: { kind: "ok", status: 200 },
    },
  ],
  ...more,
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

  it("stores no devices for an audited page that the audit measured and does not trust the worker's page number", () => {
    // Review pass 24: the audit's own reads of the page, as the worker copies them into its row.
    const table = readSiteSpeed(
      site([
        { ...extra(SEO_TEST_PAGE), n: null, source: "links" },
        extra(EXTRA, { n: 3, source: "audited" }),
      ]),
      [SEO_TEST_PAGE],
      readPageSpeed(section(SEO_TEST_PAGE), SEO_TEST_PAGE),
    );
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
      // The worker's template of a path with a number segment.
      extra("https://example.test/2026/books", { group: "/#/*" }),
      // A "#" that is no whole segment starts a fragment.
      extra("https://example.test/frag", { group: "/a#b" }),
    ])?.rows;
    expect(rows).toHaveLength(5);
    expect(rows![3]).toMatchObject({ group: "/#/*" });
    expect(rows![4]).not.toHaveProperty("group");
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
    // The worker's fixed sentence for its cap on pages.
    expect(
      reason("The speed check has a limit of 30 pages for each audit."),
    ).toBe("limit");
  });

  it("reads a reason that is no string as the other code and keeps the table", () => {
    const table = read([extra(EXTRA)], {
      notChecked: { count: 4, reason: { toString: null }, pages: [] },
    });
    expect(table?.notChecked).toEqual({ count: 4, reason: "other" });
    expect(table?.rows).toHaveLength(1);
  });

  it("keeps one device on a reduced row: the worker's placeholder for the other device is no result", () => {
    const none = { none: "reduced check: measured on mobile only" };
    const speed = { ...section(EXTRA), desktop: { lab: none, field: none } };
    const devices = (tier: string) =>
      read([extra(EXTRA, { tier, check, speed })])?.rows[0]?.devices.map(
        (item) => item.device,
      );
    expect(devices("reduced")).toEqual(["mobile"]);
    expect(devices("full")).toEqual(["mobile", "desktop"]);
  });

  it("drops only the row with a URL the stored table cannot hold", () => {
    const table = read([
      extra(`https://example.test/${"z".repeat(4100)}`, { speed: null }),
      extra(EXTRA),
    ]);
    expect(table?.rows.map((row) => row.url)).toEqual([EXTRA]);
    expect(table?.dropped).toBe(1);
  });

  it("reads a home page without its root slash as the home page", () => {
    const home = "https://example.test";
    expect(read([extra(home, { speed: null })])?.rows).toMatchObject([
      { url: home + "/", audited: false },
    ]);
    expect(
      readSiteSpeed(site([extra(home), extra(home + "/")]), [home + "/"], []),
    ).toMatchObject({
      rows: [{ url: home + "/", audited: true }],
      dropped: 1,
    });
  });

  it("drops credential material: the text of a row, or the row when its URL holds it", () => {
    const table = read([
      extra(EXTRA, {
        why: `Use API credential ${SECRET}`,
        group: `/${SECRET}`,
      }),
      extra(`https://example.test/${SECRET}`, { speed: null }),
    ]);
    expect(table?.rows.map((row) => row.url)).toEqual([EXTRA]);
    expect(table?.dropped).toBe(1);
    expect(JSON.stringify(table)).not.toContain(SECRET);
  });

  it("caps the table at 40 pages and keeps a repeated page once", () => {
    const many = read(
      Array.from({ length: 45 }, (_, i) =>
        extra(`https://example.test/p${i}`, { speed: null }),
      ),
    );
    // The first 40 pages in the worker's order.
    expect(many?.rows.map((row) => row.url)).toEqual(
      Array.from({ length: 40 }, (_, i) => `https://example.test/p${i}`),
    );
    expect(many?.dropped).toBe(5);
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

  it("gives an audited page one measurement per device and prefers the page's own", () => {
    const other = "https://example.test/other";
    const speed = (pageUrl: string, device: "mobile" | "desktop") => ({
      pageUrl,
      testedUrl: EXTRA,
      device,
      lab: { status: "unavailable" as const },
      field: { status: "no_data" as const },
    });
    const devices = (pageSpeed: ReturnType<typeof speed>[]) =>
      scopedSiteSpeed(
        {
          siteSpeed: {
            rows: [{ url: EXTRA, audited: true, devices: [] }],
            dropped: 0,
          },
          pageSpeed,
          pageUrls: [SEO_TEST_PAGE, other, EXTRA],
        },
        row,
        new Set([SEO_TEST_PAGE, other, EXTRA]),
      )?.rows[0]?.devices.map((item) => [item.pageUrl, item.device]);
    // Two pages redirect to this page on mobile.
    expect(
      devices([speed(SEO_TEST_PAGE, "mobile"), speed(other, "mobile")]),
    ).toEqual([[SEO_TEST_PAGE, "mobile"]]);
    expect(
      devices([
        speed(other, "mobile"),
        speed(other, "desktop"),
        speed(EXTRA, "mobile"),
      ]),
    ).toEqual([
      [EXTRA, "mobile"],
      [other, "desktop"],
    ]);
  });

  it("keeps a row's own device that the audit did not measure for a page another page redirects to (review pass 17)", () => {
    // The audited page redirects to /pricing on mobile only: the audit measured /pricing on mobile, not on desktop.
    const pageSpeed = readPageSpeed(
      section(SEO_TEST_PAGE, EXTRA),
      SEO_TEST_PAGE,
      { mobile: EXTRA },
    ).filter((own) => own.device === "mobile");
    const siteSpeed = readSiteSpeed(
      site([extra(EXTRA)]),
      [SEO_TEST_PAGE],
      pageSpeed,
    );
    expect(
      siteSpeed?.rows.map((item) => [
        item.audited,
        item.devices.map((own) => own.device),
      ]),
    ).toEqual([[true, ["desktop"]]]);
    const table = scopedSiteSpeed(
      { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
      row,
      new Set([SEO_TEST_PAGE]),
    );
    expect(
      table?.rows[0]?.devices.map((item) => [
        item.pageUrl,
        item.device,
        item.lab.status,
      ]),
    ).toEqual([
      [SEO_TEST_PAGE, "mobile", "measured"],
      [EXTRA, "desktop", "deadline"],
    ]);
  });

  it("keeps a row's measured device when the audit read of a page that redirects to it is a gap (review pass 22)", () => {
    // The audited page redirects to /pricing on mobile and its lab test hit a quota. The report measured /pricing on mobile.
    const pageSpeed = [
      {
        pageUrl: SEO_TEST_PAGE,
        testedUrl: EXTRA,
        device: "mobile" as const,
        lab: { status: "quota" as const },
        field: { status: "no_data" as const },
      },
    ];
    const siteSpeed = readSiteSpeed(
      site([extra(EXTRA)]),
      [SEO_TEST_PAGE],
      pageSpeed,
    );
    const table = scopedSiteSpeed(
      { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
      row,
      new Set([SEO_TEST_PAGE]),
    );
    expect(
      table?.rows[0]?.devices.map((item) => [
        item.pageUrl,
        item.device,
        item.lab.status,
      ]),
    ).toEqual([
      [EXTRA, "mobile", "measured"],
      [EXTRA, "desktop", "deadline"],
    ]);
  });

  it("shows the measured read of a target that two audited pages redirect to, whatever the audit's order (review pass 23)", () => {
    // Two audited pages redirect to /pricing on mobile: one lab test hit a quota, the other measured the page.
    const other = "https://example.test/other";
    const measured = readPageSpeed(section(other, EXTRA), other, {
      mobile: EXTRA,
    }).filter((own) => own.device === "mobile");
    const quota = {
      pageUrl: SEO_TEST_PAGE,
      testedUrl: EXTRA,
      device: "mobile" as const,
      lab: { status: "quota" as const },
      field: { status: "no_data" as const },
    };
    for (const pageSpeed of [
      [quota, ...measured],
      [...measured, quota],
    ]) {
      const siteSpeed = readSiteSpeed(
        site([extra(EXTRA)]),
        [SEO_TEST_PAGE, other],
        pageSpeed,
      );
      const table = scopedSiteSpeed(
        { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE, other] },
        row,
        new Set([SEO_TEST_PAGE, other]),
      );
      expect(
        table?.rows[0]?.devices.map((item) => [
          item.pageUrl,
          item.device,
          item.lab.status,
        ]),
      ).toEqual([
        [other, "mobile", "measured"],
        [EXTRA, "desktop", "deadline"],
      ]);
    }
  });

  it("keeps the report's measured values over an audit gap when neither has a Core Web Vital (review pass 38)", () => {
    // The audit tested the redirect target and recorded a gap, or (review pass 39) a measured field without any
    // value; the report holds FCP and TTFB only.
    for (const field of [{ none: "quota" }, cruxField(EXTRA, {})]) {
      const pageSpeed = readPageSpeed(
        {
          ...section(SEO_TEST_PAGE, EXTRA),
          mobile: { lab: { none: "quota" }, field },
        },
        SEO_TEST_PAGE,
        { mobile: EXTRA },
      ).filter((own) => own.device === "mobile");
      expect(pageSpeed[0]?.field.status).toBe(
        "none" in field ? "quota" : "measured",
      );
      const speed = {
        ...section(EXTRA),
        mobile: {
          lab: { none: "Time budget expired" },
          field: cruxField(EXTRA, { fcp: 1100, ttfb: 210 }),
        },
      };
      const siteSpeed = readSiteSpeed(
        site([extra(EXTRA, { speed })]),
        [SEO_TEST_PAGE],
        pageSpeed,
      );
      expect(
        siteSpeed?.rows[0]?.devices.map((item) => [
          item.device,
          item.field.status,
        ]),
      ).toContainEqual(["mobile", "measured"]);
      const table = scopedSiteSpeed(
        { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
        row,
        new Set([SEO_TEST_PAGE]),
      );
      expect(
        table?.rows[0]?.devices
          .filter((item) => item.device === "mobile")
          .map((item) => [item.pageUrl, item.field.status]),
      ).toEqual([[EXTRA, "measured"]]);
    }
  });

  it("ranks a Lighthouse score above a gap, and a history whose weeks hold no value as no value (review pass 40)", () => {
    const mobile = (rows: ReturnType<typeof readPageSpeed>) => {
      const found = rows.find((own) => own.device === "mobile");
      if (!found) throw new Error("no mobile read");
      return found;
    };
    const gap = { lab: { none: "quota" }, field: { none: "quota" } };
    const audit = mobile(
      readPageSpeed(
        { ...section(SEO_TEST_PAGE, EXTRA), mobile: gap },
        SEO_TEST_PAGE,
        { mobile: EXTRA },
      ),
    );
    const tested = mobile(readPageSpeed(section(EXTRA), EXTRA));
    const fcp = mobile(
      readPageSpeed(
        {
          ...section(EXTRA),
          mobile: { ...gap, field: cruxField(EXTRA, { fcp: 1100 }) },
        },
        EXTRA,
      ),
    );
    if (tested.lab.status !== "measured" || fcp.field.status !== "measured")
      throw new Error("no measured read");
    const none = <T extends object>(values: T) =>
      Object.fromEntries(Object.keys(values).map((key) => [key, null])) as {
        [K in keyof T]: null;
      };
    // The report's lab has no timing but a score; the audit read is a gap.
    const scored = {
      ...tested,
      lab: {
        ...tested.lab,
        median: none(tested.lab.median),
        pageSpeed: { scores: { accessibility: 92 }, insights: [] },
      },
    };
    // The audit's field has no value and a weekly series without a value; the report has FCP.
    const emptyWeeks = {
      ...audit,
      field: {
        ...fcp.field,
        p75: none(fcp.field.p75),
        history: {
          status: "comparable" as const,
          weeks: ["2026-10-18", "2026-10-25"],
          // Review pass 41: one week with a value draws no trend in the web.
          lcp: [null, 3000],
        },
      },
    };
    const shown = (own: typeof audit, report: typeof audit) =>
      scopedSiteSpeed(
        {
          siteSpeed: {
            rows: [
              { url: EXTRA, audited: true, tier: "full", devices: [report] },
            ],
            dropped: 0,
          },
          pageSpeed: [own],
          pageUrls: [SEO_TEST_PAGE],
        },
        row,
        new Set([SEO_TEST_PAGE]),
      )?.rows[0]?.devices.find((item) => item.device === "mobile")?.pageUrl;
    expect(shown(audit, scored)).toBe(EXTRA);
    const insight = {
      ...scored,
      lab: {
        ...scored.lab,
        pageSpeed: {
          scores: {},
          insights: [
            {
              id: "render-blocking-insight",
              title: "Render blocking requests",
              detail: "Requests block the first paint.",
              action: "Defer the scripts.",
            },
          ],
        },
      },
    };
    expect(shown(audit, insight)).toBe(EXTRA);
    expect(shown(emptyWeeks, fcp)).toBe(EXTRA);
    // Two weeks with a value draw a trend, so that report read wins over the audit gap.
    const trend = {
      ...fcp,
      field: {
        ...emptyWeeks.field,
        history: { ...emptyWeeks.field.history, lcp: [2400, 2600] },
      },
    };
    expect(shown(audit, trend)).toBe(EXTRA);
  });

  it("gives a measured field read of the audit the target's device over the report's lab read (review pass 23)", () => {
    // The field read decides the verdict: an audit read with field data shows more than a lab read alone.
    // Review pass 24: a real CrUX field, read as an import reads it.
    const audit = section(SEO_TEST_PAGE, EXTRA);
    const pageSpeed = readPageSpeed(
      {
        ...audit,
        mobile: {
          lab: { none: "quota" },
          field: cruxField(EXTRA, { lcp: 5200 }),
        },
      },
      SEO_TEST_PAGE,
      { mobile: EXTRA },
    ).filter((own) => own.device === "mobile");
    expect(pageSpeed.map((own) => [own.lab.status, own.field.status])).toEqual([
      ["quota", "measured"],
    ]);
    const siteSpeed = readSiteSpeed(
      site([extra(EXTRA)]),
      [SEO_TEST_PAGE],
      pageSpeed,
    );
    const table = scopedSiteSpeed(
      { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
      row,
      new Set([SEO_TEST_PAGE]),
    );
    expect(
      table?.rows[0]?.devices.map((item) => [
        item.pageUrl,
        item.device,
        item.lab.status,
        item.field.status,
      ]),
    ).toEqual([
      [SEO_TEST_PAGE, "mobile", "quota", "measured"],
      [EXTRA, "desktop", "deadline", "no_data"],
    ]);
  });

  it("gives the report's read with field data the target's device over an audit lab read alone (review pass 23)", () => {
    const pageSpeed = readPageSpeed(
      section(SEO_TEST_PAGE, EXTRA),
      SEO_TEST_PAGE,
      { mobile: EXTRA },
    ).filter((own) => own.device === "mobile");
    const own = section(EXTRA);
    const field = cruxField(EXTRA, { lcp: 5200, inp: 60, cls: 0 });
    const siteSpeed = readSiteSpeed(
      site([
        extra(EXTRA, { speed: { ...own, mobile: { ...own.mobile, field } } }),
      ]),
      [SEO_TEST_PAGE],
      pageSpeed,
    );
    const table = scopedSiteSpeed(
      { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
      row,
      new Set([SEO_TEST_PAGE]),
    );
    expect(
      table?.rows[0]?.devices.map((item) => [
        item.pageUrl,
        item.device,
        item.field.status,
      ]),
    ).toEqual([
      [EXTRA, "mobile", "measured"],
      [EXTRA, "desktop", "no_data"],
    ]);
  });

  it("ranks a read by the values the verdict reads: a field without a Core Web Vital is no field data (review pass 24)", () => {
    // A CrUX record with only FCP and TTFB decides no verdict, so it does not outrank a lab test that does.
    const timings = cruxField(EXTRA, { fcp: 1500, ttfb: 600 });
    const own = section(EXTRA);
    const shown = (audit: object, report: object) => {
      const pageSpeed = readPageSpeed(
        { ...section(SEO_TEST_PAGE, EXTRA), mobile: audit },
        SEO_TEST_PAGE,
        { mobile: EXTRA },
      ).filter((item) => item.device === "mobile");
      const siteSpeed = readSiteSpeed(
        site([extra(EXTRA, { speed: { ...own, mobile: report } })]),
        [SEO_TEST_PAGE],
        pageSpeed,
      );
      const table = scopedSiteSpeed(
        { siteSpeed: siteSpeed!, pageSpeed, pageUrls: [SEO_TEST_PAGE] },
        row,
        new Set([SEO_TEST_PAGE]),
      );
      const mobile = table?.rows[0]?.devices.find(
        (item) => item.device === "mobile",
      );
      return [mobile?.pageUrl, mobile?.lab.status, mobile?.field.status];
    };
    const noData = { none: "no CrUX data for the URL, origin: no data" };
    // The audit's lab test decides; the report's read has a lab gap and the timings only.
    expect(
      shown(
        { lab: lab(EXTRA, "mobile"), field: noData },
        { lab: { none: "Time budget expired" }, field: timings },
      ),
    ).toEqual([SEO_TEST_PAGE, "measured", "no_data"]);
    // The report's lab test decides; the audit's read has a lab gap and the timings only.
    expect(
      shown(
        { lab: { none: "quota" }, field: timings },
        { lab: lab(EXTRA, "mobile"), field: noData },
      ),
    ).toEqual([EXTRA, "measured", "no_data"]);
    // Review pass 25: a read whose values give a verdict ranks before one that gives none. A field with INP alone
    // gives none; a field LCP over its limit gives one, whatever the lab of either read holds.
    const blankLab = {
      ...lab(EXTRA, "mobile"),
      median: { ...median, lcp: null, cls: null },
    };
    expect(
      shown(
        { lab: blankLab, field: cruxField(EXTRA, { lcp: 5200 }) },
        { lab: lab(EXTRA, "mobile"), field: cruxField(EXTRA, { inp: 100 }) },
      ),
    ).toEqual([SEO_TEST_PAGE, "measured", "measured"]);
    expect(
      shown(
        { lab: lab(EXTRA, "mobile"), field: cruxField(EXTRA, { inp: 100 }) },
        {
          lab: { none: "quota" },
          field: cruxField(EXTRA, { lcp: 5200, cls: 0.3 }),
        },
      ),
    ).toEqual([EXTRA, "quota", "measured"]);
    // One value over its limit gives a verdict alone, and so do LCP and CLS within their limits.
    for (const p75 of [{ lcp: 5200 }, { lcp: 1800, cls: 0 }] as Record<
      string,
      number
    >[])
      expect(
        shown(
          { lab: { none: "quota" }, field: cruxField(EXTRA, { inp: 100 }) },
          { lab: { none: "quota" }, field: cruxField(EXTRA, p75) },
        ),
      ).toEqual([EXTRA, "quota", "measured"]);
    // A lab test without LCP and CLS decides no verdict either.
    const blank = lab(EXTRA, "mobile");
    expect(
      shown(
        {
          lab: { ...blank, median: { ...median, lcp: null, cls: null } },
          field: noData,
        },
        { lab: blank, field: noData },
      ),
    ).toEqual([EXTRA, "measured", "no_data"]);
  });

  it("keeps a report row whose CrUX field URL Core cannot store and marks only that field unavailable, fresh and stored (review pass 24)", () => {
    const long = `${EXTRA}/${"z".repeat(4100)}`;
    const field = cruxField(
      EXTRA,
      { lcp: 5200 },
      {
        url: long,
        identity: {
          pageAssessment: "not_determined",
          populationScope: "normalized_url_aggregate",
          requestedUrl: EXTRA,
          returnedUrl: long,
          returnedDevice: "PHONE",
          normalization: { originalUrl: EXTRA, normalizedUrl: long },
        },
      },
    );
    const own = section(EXTRA);
    const speed = { ...own, mobile: { ...own.mobile, field } };
    const fresh = read([extra(EXTRA, { speed })]);
    const stored = publicSeoPayloadSchema.parse({
      ...parsePublicSeoArtifact(site([])),
      siteSpeed: {
        dropped: 0,
        rows: [
          {
            url: EXTRA,
            audited: false,
            // Review pass 25: the stored record holds the long URL, so the stored read meets it.
            devices: readPageSpeed(own, EXTRA).map((item) =>
              item.device === "mobile"
                ? {
                    ...item,
                    field: {
                      status: "measured",
                      level: "normalized",
                      url: long,
                      p75: {
                        lcp: 5200,
                        inp: null,
                        cls: null,
                        ttfb: null,
                        fcp: null,
                      },
                      period: null,
                    },
                  }
                : item,
            ),
          },
        ],
      },
    }).siteSpeed;
    for (const table of [fresh, stored]) {
      expect(
        table?.rows[0]?.devices.map((item) => [
          item.device,
          item.lab.status,
          item.field.status,
        ]),
      ).toEqual([
        ["mobile", "measured", "unavailable"],
        ["desktop", "deadline", "no_data"],
      ]);
    }
  });

  it("keeps a report row's device for a directly audited page that the audit did not measure, in the import and the view (review pass 24)", () => {
    const table = readSiteSpeed(
      site([extra(SEO_TEST_PAGE)]),
      [SEO_TEST_PAGE],
      [],
    );
    const shown = scopedSiteSpeed(
      { siteSpeed: table!, pageSpeed: [], pageUrls: [SEO_TEST_PAGE] },
      row,
      new Set([SEO_TEST_PAGE]),
    );
    expect(
      shown?.rows[0]?.devices.map((item) => [item.device, item.lab.status]),
    ).toEqual([
      ["mobile", "measured"],
      ["desktop", "deadline"],
    ]);
  });

  it("gives no table to a view that lacks an audited page", () => {
    expect(scopedSiteSpeed(stored, row, new Set([EXTRA]))).toBeNull();
  });
});

describe("the guards of speed data on each path", () => {
  const view = { id: "o1", observedAt: new Date("2026-11-01T00:00:00Z") };
  const HIDDEN = `https://example.test/${SECRET}`;
  const device = (
    pageUrl: string,
    name: "mobile" | "desktop",
    testedUrl = pageUrl,
  ) => ({
    pageUrl,
    testedUrl,
    device: name,
    lab: { status: "unavailable" as const },
    field: { status: "no_data" as const },
  });
  /** An audit as the database holds it, with a table Core wrote before these guards. */
  const storedAudit = (rows: unknown[], pageSpeed?: unknown[]) => ({
    ...JSON.parse(JSON.stringify(parsePublicSeoArtifact(site([])))),
    ...(pageSpeed && { pageSpeed }),
    siteSpeed: { rows, dropped: 0 },
  });
  const storedRows = (rows: unknown[]) =>
    publicSeoPayloadSchema.parse(storedAudit(rows)).siteSpeed;
  const throws = () => ({
    get lab(): never {
      throw new Error("a section Core cannot read");
    },
  });

  it("reads no measurement of a fresh import on a tested URL with credential material", () => {
    const rows = readPageSpeed(section(SEO_TEST_PAGE), SEO_TEST_PAGE, {
      mobile: HIDDEN,
    });
    expect(rows.map((row) => row.device)).toEqual(["desktop"]);
  });

  it("keeps a redirect with credential material out of an audited row's devices", () => {
    const [page] = site([]).pages;
    const audit = parsePublicSeoArtifact({
      ...site([extra(SEO_TEST_PAGE, { speed: null })]),
      pages: [
        { ...page, header: { ...page!.header, finalUrl: { mobile: HIDDEN } } },
      ],
    });
    const table = scopedSiteSpeed(audit, view, new Set([SEO_TEST_PAGE]));
    expect(table?.rows[0]?.devices.map((row) => row.device)).toEqual([
      "desktop",
    ]);
    expect(JSON.stringify([audit.pageSpeed, table])).not.toContain(SECRET);
  });

  it("drops a stored row measurement whose tested URL is another page (review pass 23)", () => {
    const [own] = readPageSpeed(section(EXTRA), EXTRA).filter(
      (item) => item.device === "mobile",
    );
    const devices = (testedUrl: string) =>
      storedRows([
        {
          url: EXTRA,
          audited: false,
          devices: [{ ...own, testedUrl }],
        },
      ])?.rows[0]?.devices.length;
    expect(devices(EXTRA)).toBe(1);
    expect(devices("https://example.test/checkout")).toBe(0);
  });

  it("drops a stored measurement with credential material in a URL, of the audit and of the table", () => {
    const read = publicSeoPayloadSchema.parse(
      storedAudit(
        [
          {
            url: EXTRA,
            audited: false,
            devices: [
              device(EXTRA, "mobile", HIDDEN),
              device(EXTRA, "desktop"),
            ],
          },
        ],
        [
          device(SEO_TEST_PAGE, "mobile", HIDDEN),
          device(SEO_TEST_PAGE, "desktop"),
        ],
      ),
    );
    expect(read.pageSpeed?.map((row) => row.device)).toEqual(["desktop"]);
    expect(read.siteSpeed?.rows[0]?.devices.map((row) => row.device)).toEqual([
      "desktop",
    ]);
    expect(JSON.stringify(read)).not.toContain(SECRET);
  });

  it("drops stored row text with credential material and keeps the row", () => {
    const table = storedRows([
      {
        url: EXTRA,
        audited: false,
        why: `Use API credential ${SECRET}`,
        group: `/${SECRET}`,
        devices: [],
      },
      { url: HIDDEN, audited: false, devices: [] },
    ]);
    expect(table).toMatchObject({ rows: [{ url: EXTRA }], dropped: 1 });
    expect(JSON.stringify(table)).not.toContain(SECRET);
  });

  it("reads credential material in a percent-encoded path as credential material, fresh and stored", () => {
    const encoded = `https://example.test/${SECRET.replaceAll("_", "%5F")}`;
    expect(encoded).not.toContain(SECRET);
    expect(
      readPageSpeed(section(SEO_TEST_PAGE), SEO_TEST_PAGE, {
        mobile: encoded,
      }).map((row) => row.device),
    ).toEqual(["desktop"]);
    expect(read([extra(encoded, { speed: null }), extra(EXTRA)])).toMatchObject(
      { rows: [{ url: EXTRA }], dropped: 1 },
    );
    const stored = publicSeoPayloadSchema.parse(
      storedAudit(
        [
          { url: encoded, audited: false, devices: [] },
          {
            url: EXTRA,
            audited: false,
            devices: [device(EXTRA, "mobile", encoded)],
          },
        ],
        [device(SEO_TEST_PAGE, "mobile", encoded)],
      ),
    );
    expect(stored.pageSpeed).toEqual([]);
    expect(stored.siteSpeed).toMatchObject({
      rows: [{ url: EXTRA, devices: [] }],
      dropped: 1,
    });
  });

  it("keeps a page with an ISBN in its path: a digit run that passes the card checksum is no credential", () => {
    const book = "https://example.test/books/9781234567002";
    expect(
      read([extra(book), extra(HIDDEN, { speed: null })])?.rows.map(
        (row) => row.url,
      ),
    ).toEqual([book]);
    expect(
      storedRows([
        { url: book, audited: false, devices: [device(book, "mobile")] },
      ])?.rows[0]?.devices,
    ).toHaveLength(1);
  });

  it("reads only the devices of a row's tier on a fresh import", () => {
    const devices = (more: object) =>
      read([extra(EXTRA, more)])?.rows[0]?.devices.map((row) => row.device);
    expect(devices({ tier: "reduced", check })).toEqual(["mobile"]);
    expect(
      devices({ tier: "reduced", check: { ...check, device: "tablet" } }),
    ).toEqual([]);
    expect(devices({ tier: "none" })).toEqual([]);
    // The other device's section is not read at all: it cannot cost the row.
    expect(
      devices({
        tier: "reduced",
        check,
        speed: { ...section(EXTRA), desktop: throws() },
      }),
    ).toEqual(["mobile"]);
  });

  it("shows only the devices of a stored row's tier", () => {
    const both = [device(EXTRA, "mobile"), device(EXTRA, "desktop")];
    const stored = (more: object) =>
      storedRows([
        { url: EXTRA, audited: false, devices: both, ...more },
      ])?.rows[0]?.devices.map((row) => row.device);
    const { record: _record, ...mix } = check.mix;
    const kept = { ...check, mix };
    expect(stored({ tier: "reduced", check: kept })).toEqual(["mobile"]);
    expect(stored({ tier: "reduced", check: { ...kept, device: 7 } })).toEqual(
      [],
    );
    expect(stored({ tier: "none" })).toEqual([]);
    expect(stored({})).toEqual(["mobile", "desktop"]);
  });

  it("gives a row in a view only the devices of its tier, audited or not", () => {
    const { record: _record, ...mix } = check.mix;
    const kept = { ...check, mix, notChecked: null } as const;
    const devices = (audited: boolean, more: object) =>
      scopedSiteSpeed(
        {
          siteSpeed: {
            rows: [
              {
                url: SEO_TEST_PAGE,
                audited,
                devices: audited
                  ? []
                  : [
                      device(SEO_TEST_PAGE, "mobile"),
                      device(SEO_TEST_PAGE, "desktop"),
                    ],
                ...more,
              },
            ],
            dropped: 0,
          },
          pageSpeed: [
            device(SEO_TEST_PAGE, "mobile"),
            device(SEO_TEST_PAGE, "desktop"),
          ],
          pageUrls: [SEO_TEST_PAGE],
        } as Parameters<typeof scopedSiteSpeed>[0],
        view,
        new Set([SEO_TEST_PAGE]),
      )?.rows[0]?.devices.map((row) => row.device);
    for (const audited of [true, false]) {
      expect(devices(audited, { tier: "reduced", check: kept })).toEqual([
        "mobile",
      ]);
      expect(devices(audited, { tier: "reduced" })).toEqual([]);
      expect(devices(audited, { tier: "none" })).toEqual([]);
      expect(devices(audited, { tier: "full" })).toHaveLength(2);
    }
  });

  it("reads the speed of a home page that the audit and the table name without its root slash", () => {
    const home = "https://example.test";
    const [page] = site([]).pages;
    const audit = parsePublicSeoArtifact({
      ...site([extra(home, { speed: null })]),
      pages: [{ ...page, request: { url: home }, speed: section(home + "/") }],
    });
    expect(audit.pageSpeed).toHaveLength(2);
    expect(
      scopedSiteSpeed(audit, view, new Set([home + "/"]))?.rows,
    ).toMatchObject([{ url: home + "/", audited: true }]);
    expect(
      scopedSiteSpeed(audit, view, new Set([home + "/"]))?.rows[0]?.devices,
    ).toHaveLength(2);
    // A redirect target without its root slash is the same page.
    expect(
      readPageSpeed(section(home + "/"), "https://www.example.test/", {
        mobile: home,
      }).map((row) => row.testedUrl),
    ).toEqual([home + "/", "https://www.example.test/"]);
  });

  it("keeps the shares of a device mix whose period is no calendar period, fresh and stored", () => {
    const period = { first: "2026-10-01", last: "2026-99-99" };
    const { record: _record, ...mix } = check.mix;
    const fresh = read([
      extra(EXTRA, {
        tier: "reduced",
        check: { ...check, mix: { ...check.mix, period } },
      }),
    ])?.rows[0];
    const stored = storedRows([
      {
        url: EXTRA,
        audited: false,
        tier: "reduced",
        check: { ...check, mix: { ...mix, period } },
        devices: [device(EXTRA, "mobile")],
      },
    ])?.rows[0];
    for (const row of [fresh, stored]) {
      expect(row?.check?.mix).toEqual({ ...mix, period: null });
      expect(row?.devices).toHaveLength(1);
    }
  });

  it("shows no device mix whose shares do not add up or whose level is not the basis, fresh and stored", () => {
    const { record: _record, ...mix } = check.mix;
    const bad = [
      { ...check, mix: { ...mix, phone: 0.8, desktop: 0.8, tablet: 0.8 } },
      { ...check, mix: { ...mix, level: "origin" } },
      { ...check, basis: "crux-origin", mix },
      // Review pass 15: a device the shares do not pick, and a mix on a basis without one.
      { ...check, device: "desktop", mix },
      { ...check, mix: { ...mix, phone: 0.35, desktop: 0.62 } },
      { ...check, basis: "default", mix },
    ];
    for (const one of bad) {
      const fresh = read([extra(EXTRA, { tier: "reduced", check: one })])
        ?.rows[0];
      const stored = storedRows([
        {
          url: EXTRA,
          audited: false,
          tier: "reduced",
          check: one,
          devices: [device(EXTRA, "mobile")],
        },
      ])?.rows[0];
      for (const row of [fresh, stored])
        expect(row?.check).toEqual({ ...one, mix: null });
    }
    // CrUX rounds each share: a sum of 1.01 stays, also with its float error.
    const rounded = { ...check, mix: { ...mix, tablet: 0.04 } };
    expect(
      read([extra(EXTRA, { tier: "reduced", check: rounded })])?.rows[0]?.check
        ?.mix,
    ).toEqual(rounded.mix);
  });

  it("drops a device mix period that ends before it starts and keeps the shares, fresh and stored (review pass 15)", () => {
    const period = { first: "2026-11-20", last: "2026-10-01" };
    const { record: _record, ...mix } = check.mix;
    const one = { ...check, mix: { ...mix, period } };
    const fresh = read([extra(EXTRA, { tier: "reduced", check: one })])
      ?.rows[0];
    const stored = storedRows([
      {
        url: EXTRA,
        audited: false,
        tier: "reduced",
        check: one,
        devices: [device(EXTRA, "mobile")],
      },
    ])?.rows[0];
    for (const row of [fresh, stored])
      expect(row?.check?.mix).toEqual({ ...mix, period: null });
  });

  it("reads a stored measurement without a field or a lab as not checked there, as a fresh import (review pass 15)", () => {
    const { field: _field, ...noField } = device(EXTRA, "mobile");
    const { lab: _lab, ...noLab } = device(EXTRA, "desktop");
    const stored = publicSeoPayloadSchema.parse(
      storedAudit([], [noField, noLab]),
    ).pageSpeed;
    expect(
      stored?.map((row) => [row.device, row.lab.status, row.field.status]),
    ).toEqual([
      ["mobile", "unavailable", "not_checked"],
      ["desktop", "not_checked", "no_data"],
    ]);
  });

  it("reads a stored field or lab Core cannot read as unavailable there and keeps the device (review pass 16)", () => {
    const stored = publicSeoPayloadSchema.parse(
      storedAudit(
        [],
        [
          { ...device(EXTRA, "mobile"), field: {} },
          { ...device(EXTRA, "desktop"), lab: { status: "other" } },
        ],
      ),
    ).pageSpeed;
    expect(
      stored?.map((row) => [row.device, row.lab.status, row.field.status]),
    ).toEqual([
      ["mobile", "unavailable", "unavailable"],
      ["desktop", "unavailable", "no_data"],
    ]);
  });

  it("counts an unreadable row once and keeps a later, readable row of the same page", () => {
    const table = read([
      extra(EXTRA, { speed: { mobile: throws() } }),
      extra(EXTRA),
      extra(EXTRA),
    ]);
    expect([table?.rows.length, table?.dropped]).toEqual([1, 2]);
  });

  it("keeps a stored row and its readable device when the other device is unreadable", () => {
    const broken = { ...device(EXTRA, "desktop"), device: "watch" };
    const table = publicSeoPayloadSchema.parse({
      ...storedAudit([
        {
          url: EXTRA,
          audited: false,
          tier: "full",
          devices: [device(EXTRA, "mobile"), broken],
        },
        { url: "https://example.test/none", audited: false, devices: [broken] },
      ]),
    }).siteSpeed;
    expect(table?.dropped).toBe(0);
    expect(
      table?.rows.map((row) => row.devices.map((item) => item.device)),
    ).toEqual([["mobile"], []]);
    // A fresh import keeps a row whose speed section gives no device too.
    expect(read([extra(EXTRA, { speed: null })])).toMatchObject({
      rows: [{ url: EXTRA, devices: [] }],
      dropped: 0,
    });
  });

  it("drops a lab insight with credential material and keeps the measurement, fresh and stored", () => {
    const insight = {
      id: "unused-javascript",
      title: "Reduce unused JavaScript",
      detail: "Potential savings of 108 KiB.",
      action: "Defer scripts until they are needed.",
    };
    const leaks = (["title", "detail", "action"] as const).map((key, i) => ({
      ...insight,
      id: `leak-${i}`,
      [key]: `Use the key ${SECRET}`,
    }));
    const speed = section(EXTRA);
    const fresh = read([
      extra(EXTRA, {
        speed: {
          ...speed,
          mobile: {
            ...speed.mobile,
            lab: {
              ...speed.mobile.lab,
              pageSpeed: {
                sourceRecord: "c".repeat(64),
                scores: { performance: 72 },
                insights: [...leaks, insight],
              },
            },
          },
        },
      }),
    ])?.rows[0]?.devices[0];
    const measured = {
      status: "measured",
      median,
      pageSpeed: { scores: { performance: 72 }, insights: [insight] },
    };
    expect(fresh?.lab).toMatchObject(measured);
    // A measurement Core stored before this guard holds the text.
    const old = JSON.parse(JSON.stringify(fresh));
    old.lab.pageSpeed.insights = [...leaks, insight];
    const stored = publicSeoPayloadSchema.parse(
      storedAudit(
        [{ url: EXTRA, audited: false, devices: [old] }],
        [{ ...old, pageUrl: SEO_TEST_PAGE, testedUrl: SEO_TEST_PAGE }],
      ),
    );
    expect(stored.pageSpeed?.[0]?.lab).toMatchObject(measured);
    expect(stored.siteSpeed?.rows[0]?.devices[0]?.lab).toMatchObject(measured);
    expect(JSON.stringify([fresh, stored])).not.toContain(SECRET);
  });

  it("drops a lab insight with credential material in its id, its group or a percent-encoded text, fresh and stored", () => {
    const insight = {
      id: "unused-javascript",
      title: "Reduce unused JavaScript",
      detail: "Potential savings of 108 KiB.",
      action: "Defer scripts until they are needed.",
    };
    const encoded = encodeURIComponent(SECRET).replaceAll("_", "%5F");
    const leaks = [
      { ...insight, id: "card-4242424242424242" },
      { ...insight, id: "leak-group", group: `Group ${SECRET}` },
      { ...insight, id: "leak-title", title: `Use the key ${encoded}` },
      { ...insight, id: "leak-detail", detail: `Key ${encoded}` },
      { ...insight, id: "leak-percent", detail: `50% less. Key ${encoded}` },
    ];
    const speed = section(EXTRA);
    const fresh = read([
      extra(EXTRA, {
        speed: {
          ...speed,
          mobile: {
            ...speed.mobile,
            lab: {
              ...speed.mobile.lab,
              pageSpeed: {
                sourceRecord: "c".repeat(64),
                scores: { performance: 72 },
                insights: [...leaks, insight],
              },
            },
          },
        },
      }),
    ])?.rows[0]?.devices[0];
    const measured = {
      status: "measured",
      median,
      pageSpeed: { scores: { performance: 72 }, insights: [insight] },
    };
    expect(fresh?.lab).toMatchObject(measured);
    const old = JSON.parse(JSON.stringify(fresh));
    old.lab.pageSpeed.insights = [...leaks, insight];
    const stored = publicSeoPayloadSchema.parse(
      storedAudit(
        [{ url: EXTRA, audited: false, devices: [old] }],
        [{ ...old, pageUrl: SEO_TEST_PAGE, testedUrl: SEO_TEST_PAGE }],
      ),
    );
    expect(stored.pageSpeed?.[0]?.lab).toMatchObject(measured);
    expect(stored.siteSpeed?.rows[0]?.devices[0]?.lab).toMatchObject(measured);
    expect(JSON.stringify([fresh, stored])).not.toMatch(/4242|leak-|%5F/);
  });

  it("applies the cap and the one row per page of a fresh import to a stored table", () => {
    const row = (url: string) => ({ url, audited: false, devices: [] });
    const twice = storedRows([row(EXTRA), row(EXTRA)]);
    expect([twice?.rows.length, twice?.dropped]).toEqual([1, 1]);
    const many = publicSeoPayloadSchema.parse({
      ...storedAudit([]),
      siteSpeed: {
        rows: Array.from({ length: 41 }, (_, i) =>
          row(`https://example.test/p${i}`),
        ),
        dropped: 2,
        notChecked: { count: 3, reason: "limit" },
      },
    }).siteSpeed;
    expect(many).toMatchObject({
      dropped: 3,
      notChecked: { count: 3, reason: "limit" },
    });
    expect(many?.rows.map((row) => row.url)).toEqual(
      Array.from({ length: 40 }, (_, i) => `https://example.test/p${i}`),
    );
  });

  it("keeps the stored rows when the summary of pages left out is unreadable", () => {
    const table = publicSeoPayloadSchema.parse({
      ...storedAudit([]),
      siteSpeed: {
        rows: [{ url: EXTRA, audited: false, devices: [] }],
        dropped: 0,
        notChecked: { count: 1, reason: "unknown" },
      },
    }).siteSpeed;
    expect(table).toEqual({
      rows: [{ url: EXTRA, audited: false, devices: [] }],
      dropped: 0,
    });
  });

  it("keeps the first readable stored measurement of each device of a row", () => {
    // A tested URL on another host is still refused (review pass 17: a lab Core cannot read is now unavailable).
    const broken = {
      ...device(EXTRA, "mobile"),
      testedUrl: "https://other.test/page",
      field: { status: "deadline" },
    };
    const second = { ...device(EXTRA, "mobile"), field: { status: "quota" } };
    const table = storedRows([
      {
        url: EXTRA,
        audited: false,
        tier: "full",
        devices: [
          broken,
          device(EXTRA, "mobile"),
          second,
          device(EXTRA, "desktop"),
        ],
      },
      {
        url: "https://example.test/twice",
        audited: false,
        tier: "full",
        devices: [
          device("https://example.test/twice", "mobile"),
          {
            ...device("https://example.test/twice", "mobile"),
            field: { status: "quota" },
          },
        ],
      },
      {
        url: "https://example.test/reduced",
        audited: false,
        tier: "reduced",
        check,
        devices: [
          device("https://example.test/reduced", "desktop"),
          device("https://example.test/reduced", "mobile"),
          device("https://example.test/reduced", "mobile"),
        ],
      },
    ]);
    expect(table?.dropped).toBe(0);
    expect(
      table?.rows.map((row) =>
        row.devices.map((item) => [item.device, item.field.status]),
      ),
    ).toEqual([
      [
        ["mobile", "no_data"],
        ["desktop", "no_data"],
      ],
      [["mobile", "no_data"]],
      [["mobile", "no_data"]],
    ]);
  });

  it("drops a page URL with an empty fragment and counts it, fresh and stored", () => {
    const fresh = read([extra(EXTRA), extra(`${EXTRA}#`)]);
    expect(fresh?.rows.map((row) => row.url)).toEqual([EXTRA]);
    expect(fresh?.dropped).toBe(1);
    const stored = storedRows([
      { url: EXTRA, audited: false, devices: [] },
      { url: `${EXTRA}#`, audited: false, devices: [] },
    ]);
    expect(stored?.rows.map((row) => row.url)).toEqual([EXTRA]);
    expect(stored?.dropped).toBe(1);
  });

  it("shows no measurement of another page on a stored row", () => {
    const table = storedRows([
      {
        url: EXTRA,
        audited: false,
        tier: "full",
        devices: [
          device("https://example.test/other", "mobile"),
          device(EXTRA, "desktop"),
        ],
      },
    ]);
    expect(
      table?.rows[0]?.devices.map((item) => [item.pageUrl, item.device]),
    ).toEqual([[EXTRA, "desktop"]]);
  });

  it("reads a stored home page without its root slash as the home page, once", () => {
    const home = "https://example.test";
    const table = storedRows([
      { url: home, audited: false, devices: [device(home, "mobile")] },
      { url: home + "/", audited: false, devices: [] },
    ]);
    expect(table).toMatchObject({
      rows: [{ url: home + "/", devices: [{ device: "mobile" }] }],
      dropped: 1,
    });
  });

  it("omits a cause and a tier that Core does not know from a stored row and keeps the row", () => {
    const table = storedRows([
      { url: EXTRA, audited: false, cause: "new-cause", devices: [] },
      {
        url: "https://example.test/tier",
        audited: false,
        tier: "new-tier",
        cause: SITE_SPEED_CAUSES[0],
        devices: [],
      },
    ]);
    expect(table).toEqual({
      rows: [
        { url: EXTRA, audited: false, devices: [] },
        {
          url: "https://example.test/tier",
          audited: false,
          cause: SITE_SPEED_CAUSES[0],
          devices: [],
        },
      ],
      dropped: 0,
    });
  });

  it("gives a view no stored row of another host and counts it", () => {
    const row = (url: string, audited = false) => ({
      url,
      audited,
      devices: [],
    });
    const table = scopedSiteSpeed(
      {
        siteSpeed: {
          rows: [
            row(EXTRA),
            row("https://other.test/pricing"),
            row("https://other.test/audited", true),
            row("https://www.example.test/shop"),
          ],
          dropped: 1,
        },
        // A stored measurement of a page outside the audit makes no page an audited one.
        pageSpeed: [
          "https://other.test/pricing",
          "https://other.test/audited",
        ].map((url) => ({
          pageUrl: url,
          testedUrl: url,
          device: "mobile" as const,
          lab: { status: "unavailable" as const },
          field: { status: "no_data" as const },
        })),
        pageUrls: [SEO_TEST_PAGE],
      },
      view,
      new Set([SEO_TEST_PAGE]),
    );
    expect(table?.rows.map((item) => item.url)).toEqual([
      EXTRA,
      "https://www.example.test/shop",
    ]);
    expect(table?.dropped).toBe(3);
  });

  it("gives an audited row no measurement of a page outside the audit that redirects to it", () => {
    const shop = "https://www.example.test/shop";
    const table = scopedSiteSpeed(
      {
        siteSpeed: {
          rows: [{ url: shop, audited: true, devices: [] }],
          dropped: 0,
        },
        pageSpeed: [
          {
            pageUrl: "https://www.example.test/old",
            testedUrl: shop,
            device: "mobile" as const,
            lab: { status: "unavailable" as const },
            field: { status: "no_data" as const },
          },
        ],
        pageUrls: [shop],
      },
      view,
      new Set([shop]),
    );
    expect(table?.rows).toMatchObject([{ url: shop, devices: [] }]);
  });

  it("drops only the stored row Core cannot read and counts it", () => {
    const table = storedRows([
      { url: EXTRA, audited: false, devices: [] },
      {
        url: `https://example.test/${"z".repeat(4100)}`,
        audited: false,
        devices: [],
      },
      { url: "https://example.test/x", audited: "yes", devices: [] },
    ]);
    expect(table).toMatchObject({ rows: [{ url: EXTRA }], dropped: 2 });
  });
});
