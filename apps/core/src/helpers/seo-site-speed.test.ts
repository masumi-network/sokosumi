import { describe, expect, it } from "vitest";
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
          pageUrls: [SEO_TEST_PAGE],
        },
        row,
        new Set([SEO_TEST_PAGE]),
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

  it("counts an unreadable row once and keeps a later, readable row of the same page", () => {
    const table = read([
      extra(EXTRA, { speed: { mobile: throws() } }),
      extra(EXTRA),
      extra(EXTRA),
    ]);
    expect([table?.rows.length, table?.dropped]).toEqual([1, 2]);
  });

  it("keeps a stored row and its readable device when the other device is unreadable", () => {
    const broken = { ...device(EXTRA, "desktop"), lab: { status: "invalid" } };
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
    const broken = { ...device(EXTRA, "mobile"), lab: { status: "invalid" } };
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
