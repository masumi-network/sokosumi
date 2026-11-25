import { describe, expect, it, vi } from "vitest";
import type { SiteTrafficInput } from "@/schemas/seo-site-traffic.schema";
import { readSiteTraffic } from "./site-traffic";

const apex = "https://sample-site.test/";
const canonical = "https://www.sample-site.test/";
const pricing = canonical + "pricing";
const foreign = "https://second-site.test/";
const request: SiteTrafficInput = {
  propertyId: "sc-domain:sample-site.test",
  scope: "site",
  pageIds: ["22222222-2222-4222-8222-222222222222"],
  from: "2026-08-22",
  to: "2026-11-18",
  searchType: "web",
};
const inspection = {
  pageUrl: apex,
  googleCanonical: canonical,
  userCanonical: canonical,
  verdict: "NEUTRAL" as const,
  coverageState: "Page with redirect",
  robotsTxtState: null,
  lastCrawlTime: null,
};
const data = [
  { keys: [apex], clicks: 0, impressions: 2 },
  { keys: [canonical], clicks: 3, impressions: 78 },
  { keys: [pricing], clicks: 9, impressions: 17 },
  { keys: [foreign], clicks: 900, impressions: 8000 },
  {
    keys: ["https://sample-site.test.example.org/"],
    clicks: 900,
    impressions: 8000,
  },
  {
    keys: ["https://docs.sample-site.test/"],
    clicks: 900,
    impressions: 8000,
  },
];
function google(args: Record<string, unknown>) {
  const [
    {
      filters: [{ expression }],
    },
  ] = args.dimension_filter_groups as { filters: { expression: string }[] }[];
  const filtered = data.filter((row) =>
    new RegExp(expression).test(row.keys[0]),
  );
  if ((args.dimensions as string[]).length)
    return Promise.resolve({ rows: filtered });
  return Promise.resolve({
    rows: [
      {
        clicks: filtered.reduce((sum, row) => sum + row.clicks, 0),
        impressions: filtered.reduce((sum, row) => sum + row.impressions, 0),
      },
    ],
  });
}
describe("website-scoped Search Console traffic", () => {
  it("discovers other pages on the open host and excludes other properties, subdomains and lookalikes from every read", async () => {
    const read = vi.fn(google);
    const report = await readSiteTraffic(
      request,
      apex,
      [apex],
      [inspection],
      read,
    );
    expect(report.totals).toEqual({ clicks: 12, impressions: 97 });
    expect(report.pages.map((p) => p.url)).toEqual([canonical, pricing]);
    expect(read.mock.calls).toHaveLength(2);
    for (const [args] of read.mock.calls)
      expect(args).toMatchObject({
        site_url: request.propertyId,
        start_date: request.from,
        end_date: request.to,
        search_type: "web",
      });
  });
  it("uses the picked URL for the daily chart, headline and ranking, including a discovered page", async () => {
    const dates = [
      { keys: [request.to], clicks: 3, impressions: 5 },
      { keys: [request.from], clicks: 6, impressions: 12 },
    ];
    const read = vi.fn((args: Record<string, unknown>) =>
      (args.dimensions as string[])[0] === "date"
        ? Promise.resolve({ rows: dates })
        : google(args),
    );
    const filtered = {
      ...request,
      scope: "selected" as const,
      pageUrls: [pricing],
      includeDaily: true,
    };
    const report = await readSiteTraffic(
      filtered,
      apex,
      [apex],
      [inspection],
      read,
    );
    expect(report.daily).toEqual([
      { date: request.from, clicks: 6, impressions: 12 },
      { date: request.to, clicks: 3, impressions: 5 },
    ]);
    expect(report.totals).toEqual({ clicks: 9, impressions: 17 });
    expect(report.pages.map((p) => p.url)).toEqual([pricing]);
    expect(
      new Set(
        read.mock.calls.map(([args]) =>
          JSON.stringify(args.dimension_filter_groups),
        ),
      ).size,
    ).toBe(1);
    await expect(
      readSiteTraffic(
        { ...filtered, pageUrls: [foreign] },
        apex,
        [apex],
        [],
        read,
      ),
    ).rejects.toThrow("Page filter");
    for (const keys of [[request.to], ["1999-01-01"], ["2026-02-31"]]) {
      await expect(
        readSiteTraffic(filtered, apex, [apex], [], async (args) =>
          (args.dimensions as string[])[0] === "date"
            ? { rows: [dates[0], { ...dates[1], keys }] }
            : google(args),
        ),
      ).rejects.toThrow(/traffic date/);
    }
  });
  it("counts each verified variant once, even when both addresses were selected", async () => {
    const report = await readSiteTraffic(
      { ...request, scope: "selected" },
      apex,
      [apex, canonical],
      [inspection],
      google,
    );
    expect(report.totals).toEqual({ clicks: 3, impressions: 80 });
    expect(report.pages).toEqual([
      {
        url: canonical,
        submitted: [apex, canonical],
        clicks: 3,
        impressions: 80,
        variants: [
          { url: apex, clicks: 0, impressions: 2 },
          { url: canonical, clicks: 3, impressions: 78 },
        ],
      },
    ]);
  });
  it("leaves a different path or unconfirmed canonical outside a selected page", async () => {
    const report = await readSiteTraffic(
      { ...request, scope: "selected" },
      apex,
      [apex],
      [{ ...inspection, googleCanonical: pricing, userCanonical: pricing }],
      google,
    );
    expect(report.totals).toEqual({ clicks: 0, impressions: 2 });
    expect(report.pages.map((p) => p.url)).toEqual([apex]);
  });
  it("keeps a URL-prefix property inside its registered path, even for a whole-site request", async () => {
    const report = await readSiteTraffic(
      { ...request, propertyId: pricing },
      apex,
      [pricing],
      [],
      google,
    );
    expect(report.totals).toEqual({ clicks: 9, impressions: 17 });
    expect(report.pages.map((page) => page.url)).toEqual([pricing]);
  });
  it("applies the same website boundary to later batches and marks a capped list", async () => {
    const filters = new Set<string>();
    const read = async (args: Record<string, unknown>) => {
      filters.add(JSON.stringify(args.dimension_filter_groups));
      if (!(args.dimensions as string[]).length)
        return { rows: [{ clicks: 3010, impressions: 4000 }] };
      return {
        rows: Array.from({ length: Number(args.row_limit) }, (_, i) => ({
          keys: [apex + (Number(args.start_row) + i)],
          clicks: 1,
          impressions: 1,
        })),
      };
    };
    const report = await readSiteTraffic(request, apex, [apex], [], read);
    expect(report.limited).toBe(true);
    expect(report.pages).toHaveLength(2500);
    expect(report.pages.at(-1)?.url).toBe(apex + "2499");
    expect(report.totals?.impressions).toBe(4000);
    expect(filters.size).toBe(1);
  });
  it("keeps the independent Google total when Google lists fewer page rows", async () => {
    const report = await readSiteTraffic(
      request,
      apex,
      [apex],
      [],
      async (args) =>
        (args.dimensions as string[]).length
          ? { rows: [data[1]] }
          : { rows: [{ clicks: 12, impressions: 97 }] },
    );
    expect(report.totals?.impressions).toBe(97);
    expect(report.pages[0].impressions).toBe(78);
  });
  it("accepts provider metadata alongside valid rows and refuses an unrecognized success envelope", async () => {
    const report = await readSiteTraffic(
      request,
      apex,
      [apex],
      [],
      async (args) => ({
        ...(await google(args)),
        metadata: {},
      }),
    );
    expect(report.totals?.impressions).toBe(97);
    await expect(
      readSiteTraffic(request, apex, [apex], [], async () => ({
        unexpected: true,
      })),
    ).rejects.toThrow();
  });
  it("distinguishes an absent aggregate from a measured zero", async () => {
    const run = (rows: unknown[]) =>
      readSiteTraffic(request, apex, [apex], [], async (args) => ({
        rows: (args.dimensions as string[]).length ? [] : rows,
      }));
    expect((await run([])).totals).toBeNull();
    expect((await run([{ clicks: 0, impressions: 0 }])).totals).toEqual({
      clicks: 0,
      impressions: 0,
    });
  });
  it("rejects unrelated properties and mixed selections before contacting Google", async () => {
    const read = vi.fn(google);
    await expect(
      readSiteTraffic(
        { ...request, propertyId: "sc-domain:second-site.test" },
        apex,
        [apex],
        [],
        read,
      ),
    ).rejects.toThrow();
    await expect(
      readSiteTraffic(request, apex, [apex, foreign], [], read),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("splits the listed queries by brand terms inside the same website boundary", async () => {
    const queries = [
      { keys: ["2026-11-17", "sample site login"], clicks: 4, impressions: 9 },
      { keys: ["2026-11-17", "running shoes"], clicks: 1, impressions: 30 },
    ];
    const read = vi.fn((args: Record<string, unknown>) =>
      (args.dimensions as string[]).join() === "date,query"
        ? Promise.resolve({ rows: queries })
        : google(args),
    );
    const report = await readSiteTraffic(
      request,
      apex,
      [apex],
      [inspection],
      read,
      ["Sample Site"],
    );
    expect(report.brand).toEqual({
      limited: false,
      daily: [
        {
          date: "2026-11-17",
          branded: { clicks: 4, impressions: 9 },
          nonBranded: { clicks: 1, impressions: 30 },
        },
      ],
    });
    const [pageRead, queryRead] = [["page"], ["date", "query"]].map(
      (dimensions) =>
        read.mock.calls.find(
          ([args]) => String(args.dimensions) === String(dimensions),
        )?.[0],
    );
    expect(queryRead?.dimension_filter_groups).toEqual(
      pageRead?.dimension_filter_groups,
    );
  });
  it("keeps the totals and pages when the query rows cannot be read", async () => {
    const report = await readSiteTraffic(
      request,
      apex,
      [apex],
      [inspection],
      (args) =>
        (args.dimensions as string[]).includes("query")
          ? Promise.reject(new Error("no query rows for this search type"))
          : google(args),
      ["Sample Site"],
    );
    expect(report.brand).toBeUndefined();
    expect(report.totals).toEqual({ clicks: 12, impressions: 97 });
  });
  it("asks a feed for no query rows", async () => {
    const read = vi.fn(google);
    const report = await readSiteTraffic(
      { ...request, searchType: "discover" },
      apex,
      [apex],
      [inspection],
      read,
      ["Sample Site"],
    );
    expect(report.brand).toBeUndefined();
    expect(
      read.mock.calls.some(([args]) =>
        (args.dimensions as string[]).includes("query"),
      ),
    ).toBe(false);
  });
  it("rejects an unexpected page from the provider before returning private measurements", async () => {
    await expect(
      readSiteTraffic(request, apex, [apex], [], async (args) => ({
        rows: (args.dimensions as string[]).length ? [data[3]] : [],
      })),
    ).rejects.toThrow("Unexpected page");
  });
});
