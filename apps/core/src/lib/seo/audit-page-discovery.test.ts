import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverAuditPages,
  readAuditPropertyEvidence,
} from "./audit-page-discovery";

const domain = "example.test";
const site = "https://www." + domain;
const gettingStarted = site + "/guides/getting-started";
const planning = site + "/guides/planning-a-project";
const lost = site + "/features";
const input = {
  propertyId: "sc-domain:" + domain,
  from: "2026-08-20",
  to: "2026-11-17",
};
const page = (url: string, clicks: number, impressions: number) => ({
  keys: [url],
  clicks,
  impressions,
});
const byPage = (rows: unknown[]) => ({
  responseAggregationType: "byPage",
  rows,
});
afterEach(() => vi.useRealTimers());
describe("private audit page discovery", () => {
  it("keeps all four clicked destinations when only one qualifies for review", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const rows = [
      page(site + "/features/dashboard", 1, 10),
      page(site + "/", 3, 83),
      page(site + "/features/activity", 2, 43),
      page(site + "/features/reports", 1, 82),
      page(site + "/quiet", 0, 4),
    ];
    const read = vi.fn(async (args: Record<string, unknown>) => {
      if (args.dimension_filter_groups) return byPage([]);
      return byPage(
        args.start_date === input.from
          ? rows
          : rows.map((row) => ({ ...row, clicks: 0, impressions: 1 })),
      );
    });
    const discovery = await discoverAuditPages(input, read);
    expect(
      discovery.topClickedPages?.map(({ pageUrl, clicks }) => [
        pageUrl,
        clicks,
      ]),
    ).toEqual([
      [site + "/", 3],
      [site + "/features/activity", 2],
      [site + "/features/reports", 1],
      [site + "/features/dashboard", 1],
    ]);
    expect(discovery.pages.map((p) => p.pageUrl)).toEqual([
      site + "/features/reports",
    ]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("finds both zero-click guides and a losing page, and suggests an edit only with matching recent query evidence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const read = vi.fn(async (args: Record<string, unknown>) => {
      expect(args.site_url).toBe(input.propertyId);
      expect(args.search_type).toBe("web");
      if (!args.dimension_filter_groups) {
        if (args.start_date === input.from)
          return byPage([
            page(gettingStarted, 0, 190),
            page(planning, 0, 150),
            page(lost, 10, 80),
          ]);
        if (args.end_date === input.to)
          return byPage([page(gettingStarted, 0, 60), page(planning, 0, 110)]);
        return byPage([
          page(gettingStarted, 0, 59),
          page(planning, 0, 30),
          page(lost, 8, 40),
        ]);
      }
      const filter = (
        args.dimension_filter_groups as [
          { filters: [{ operator: string; expression: string }] },
        ]
      )[0].filters[0];
      expect(filter.operator).toBe("equals");
      expect(args.start_date).toBe("2026-10-21");
      if ((args.dimensions as string[]).length === 1) {
        expect(filter.expression).toBe(lost);
        return byPage([]);
      }
      return byPage(
        filter.expression === planning
          ? [
              {
                keys: ["planning a project", planning],
                clicks: 0,
                impressions: 14,
                ctr: 0,
                position: 4.1,
              },
            ]
          : [],
      );
    });
    const result = await discoverAuditPages(input, read);
    expect(result.recent).toEqual({ from: "2026-10-21", to: input.to });
    expect(result.previous).toEqual({ from: "2026-09-23", to: "2026-10-20" });
    expect(result.pages).toHaveLength(3);
    expect(result.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageUrl: gettingStarted,
          reason: "lowCtr",
          suggestion: null,
          query: null,
        }),
        expect.objectContaining({
          pageUrl: planning,
          reason: "gainingImpressions",
          suggestion: expect.stringContaining("planning a project"),
        }),
        expect.objectContaining({
          pageUrl: lost,
          reason: "lostClicks",
          recent: { clicks: 0, impressions: 0 },
          suggestion: null,
        }),
      ]),
    );
  });

  it("keeps confirmed page counts after a query failure and retries only that page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const read = vi.fn(async (args: Record<string, unknown>) => {
      if (!args.dimension_filter_groups) {
        const impressions = args.start_date === input.from ? 120 : 40;
        return byPage([
          page(planning, 0, impressions),
          page(gettingStarted, 0, impressions),
        ]);
      }
      if (JSON.stringify(args.dimension_filter_groups).includes(planning))
        throw new Error("Google unavailable");
      return byPage([]);
    });
    const saved = await readAuditPropertyEvidence(input, read, false, true);
    expect(
      saved.auditPageDiscovery?.pages.find((p) => p.pageUrl === planning),
    ).toMatchObject({
      queryUnavailable: true,
      suggestion: null,
      totals: { impressions: 120 },
    });
    const recovery = vi.fn(async (args: Record<string, unknown>) => {
      expect(args.dimensions).toEqual(["query", "page"]);
      expect(JSON.stringify(args.dimension_filter_groups)).toContain(planning);
      return byPage([]);
    });
    const updated = await readAuditPropertyEvidence(
      input,
      recovery,
      false,
      true,
      saved,
    );
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(
      updated.auditPageDiscovery?.pages.some((p) => p.queryUnavailable),
    ).toBe(false);
    expect(updated.auditPageDiscovery?.pages).toHaveLength(2);
  });

  it("drops an apparent click loss when the exact URL read finds the missing traffic", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const result = await discoverAuditPages(input, async (args) => {
      expect(args.dimensions).toEqual(["page"]);
      if (args.start_date === input.from) return byPage([page(lost, 20, 90)]);
      if (args.end_date === input.to && !args.dimension_filter_groups)
        return byPage([]);
      return byPage([page(lost, 8, 30)]);
    });
    expect(result.pages).toEqual([]);
  });

  it("keeps top destinations and confirmed pages across failed comparisons and completes a retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const rows = [page(planning, 1, 150), page(lost, 0, 90)];
    let failure = "exact";
    const read = async (args: Record<string, unknown>) => {
      if (args.dimension_filter_groups) {
        if (failure === "exact" && args.dimensions?.toString() === "page")
          throw new Error("Exact page unavailable");
        return byPage([]);
      }
      if (args.start_date === input.from) return byPage(rows);
      if (failure === "window") throw new Error("Comparison unavailable");
      return byPage([rows[0]]);
    };
    const first = await readAuditPropertyEvidence(input, read, false, true);
    expect(first.auditPageDiscovery).toMatchObject({
      comparisonIncomplete: true,
      topClickedPages: [{ pageUrl: planning }],
      pages: [{ pageUrl: planning }],
    });
    failure = "window";
    const partial = await readAuditPropertyEvidence(
      input,
      read,
      false,
      true,
      first,
    );
    expect(partial).toEqual(first);
    failure = "";
    const recovered = await readAuditPropertyEvidence(
      input,
      read,
      false,
      true,
      partial,
    );
    expect(recovered.auditPageDiscovery?.comparisonIncomplete).toBeUndefined();
    expect(recovered.auditPageDiscovery?.pages).toHaveLength(2);
  });

  it("rejects an out-of-property page before requesting its queries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20"));
    const read = vi.fn(async () =>
      byPage([page("https://outside.test/private", 0, 100)]),
    );
    await expect(discoverAuditPages(input, read)).rejects.toThrow(
      "Unexpected Search Console page",
    );
    expect(read).toHaveBeenCalledTimes(3);
  });
});
