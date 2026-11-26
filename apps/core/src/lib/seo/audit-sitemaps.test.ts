import { expect, it } from "vitest";
import type { AuditDiscovery } from "@/schemas/seo-sitemap-evidence.schema";
import { auditDiscoveryResult } from "./audit-discovery-actions";
import { discoveryChanges, readSubmittedSitemaps } from "./audit-sitemaps";

const site = "sc-domain:example.test",
  root = "https://example.test/map.xml",
  child = "https://example.test/posts.xml";
it("expands index files once, reads the provider fields, and ignores Google's deprecated indexed value", async () => {
  const calls: unknown[] = [];
  const data = await readSubmittedSitemaps(site, async (args) => {
    calls.push(args);
    return args.sitemap_index
      ? {
          sitemap: [
            { path: root, isSitemapsIndex: true },
            {
              path: child,
              errors: "0",
              contents: [{ type: "web", submitted: "5", indexed: "200" }],
            },
          ],
        }
      : {
          data: {
            sitemap: [{ path: root, isSitemapsIndex: true, isPending: false }],
          },
        };
  });
  expect(calls).toEqual([
    { site_url: site },
    { site_url: site, sitemap_index: root },
  ]);
  expect(data).toMatchObject({
    status: "available",
    sitemaps: [{ path: root }, { path: child, errors: 0, webUrls: 5 }],
  });
  expect(data.sitemaps[1]).not.toHaveProperty("indexed");
});
it("publishes no submission advice for partial, malformed or unavailable inventories", async () => {
  const responses = [
    { sitemap: [{ path: "bad" }] },
    { sitemap: null },
    { sitemap: [{ path: "https://different.test/map.xml" }] },
    { error: "no access" },
    { other: 8 },
  ];
  for (const response of responses) {
    const result = await readSubmittedSitemaps(site, async () => response);
    expect(result.status).not.toBe("available");
    expect(
      auditDiscoveryResult(
        {
          ...result,
          checkedAt: "2026-02-01T00:00:00Z",
          changes: [],
          inspections: [],
        },
        site,
        [root],
      ).actions,
    ).toEqual([]);
  }
  const empty = await readSubmittedSitemaps(site, async () => ({}));
  expect(
    auditDiscoveryResult(
      {
        ...empty,
        checkedAt: "2026-02-01T00:00:00Z",
        changes: [],
        inspections: [],
      },
      site,
      [root],
    ).actions[0].url,
  ).toBe(root);
});
it("requires separate Google downloads for a three-observation decline and excludes expected redirects from repair advice", async () => {
  async function observation(
    day: string,
    count: number,
  ): Promise<AuditDiscovery> {
    const date = day + "T00:00:00.000Z";
    return {
      ...(await readSubmittedSitemaps(site, async () => ({
        sitemap: [
          {
            path: root,
            lastDownloaded: date,
            contents: [{ type: "web", submitted: count }],
          },
        ],
      }))),
      checkedAt: date,
      changes: [],
      inspections: [
        {
          page: "https://example.test/",
          verdict: "NEUTRAL",
          reason: "Page with redirect",
          canonical: null,
          crawledAt: null,
          checkedAt: date,
        },
      ],
    };
  }
  const [first, second, third] = await Promise.all([
    observation("2026-01-01", 40),
    observation("2026-01-10", 30),
    observation("2026-01-20", 20),
  ]);
  expect(discoveryChanges(third, second, first)[0].text).toContain(
    "40 → 30 → 20",
  );
  expect(discoveryChanges(third, third, first)).toEqual([]);
  third.sitemaps[0].downloadedAt = second.sitemaps[0].downloadedAt;
  expect(discoveryChanges(third, second, first)).toEqual([]);
  expect(auditDiscoveryResult(third, site, [root]).actions).toEqual([]);
});

it("dates a coverage change from the inspection when the report was assembled later", () => {
  const make = (
    checkedAt: string,
    read: string,
    reason: string,
  ): AuditDiscovery => ({
    checkedAt,
    status: "available",
    sitemaps: [],
    changes: [],
    inspections: [
      {
        page: root,
        verdict: "NEUTRAL",
        reason,
        canonical: null,
        crawledAt: null,
        checkedAt: read,
      },
    ],
  });
  const previous = make(
    "2026-01-02T08:00:00Z",
    "2026-01-01T23:00:00Z",
    "Discovered",
  );
  const current = make(
    "2026-01-05T08:00:00Z",
    "2026-01-04T23:00:00Z",
    "Crawled",
  );
  expect(discoveryChanges(current, previous)).toMatchObject([
    { previousDay: "2026-01-01", currentDay: "2026-01-04" },
  ]);
});
