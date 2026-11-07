import { describe, expect, it } from "vitest";

import { SEO_SEARCH_QUERY_ROW_LIMIT } from "@/schemas/project-seo.schema";
import { gscQueryArguments, normalizeGscQueries } from "./native-gsc-queries";
import { gscStatisticsArguments } from "./native-statistics";

const query = {
  provider: "search_console" as const,
  propertyId: "sc-domain:example.test",
  pageUrls: ["https://www.example.test/", "https://www.example.test/a"],
  from: "2026-10-09",
  to: "2026-11-05",
  channel: "organic" as const,
};
const row = (keys: string[], impressions = 10) => ({
  keys,
  clicks: 1,
  impressions,
  ctr: 0.1,
  position: 6.5,
});

describe("Search Console query rows", () => {
  it("reuses the exact page filter and dates of the totals", () => {
    const rows = gscQueryArguments(query),
      totals = gscStatisticsArguments(query, false);
    expect(rows.dimensions).toEqual(["query", "page"]);
    expect(rows.row_limit).toBe(SEO_SEARCH_QUERY_ROW_LIMIT);
    for (const key of [
      "site_url",
      "start_date",
      "end_date",
      "search_type",
      "data_state",
      "dimension_filter_groups",
    ])
      expect(rows[key]).toEqual(totals[key]);
  });

  it("normalizes rows without inventing volume, market or device", () => {
    const result = normalizeGscQueries(query, {
      rows: [row(["battery health", "https://www.example.test/"])],
    });
    expect(result).toEqual({
      rowLimit: SEO_SEARCH_QUERY_ROW_LIMIT,
      truncated: false,
      rows: [
        {
          query: "battery health",
          pageUrl: "https://www.example.test/",
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          averagePosition: 6.5,
        },
      ],
    });
  });

  it("accepts an empty response as zero rows", () => {
    expect(normalizeGscQueries(query, {}).rows).toEqual([]);
  });

  it("refuses rows outside the selected pages, other groupings and duplicates", () => {
    expect(() =>
      normalizeGscQueries(query, {
        rows: [row(["q", "https://www.example.test/other"])],
      }),
    ).toThrow("outside the selection");
    expect(() => normalizeGscQueries(query, { rows: [row(["q"])] })).toThrow(
      "different query grouping",
    );
    expect(() =>
      normalizeGscQueries(query, {
        rows: [
          row(["q", "https://www.example.test/a"]),
          row(["q", "https://www.example.test/a"]),
        ],
      }),
    ).toThrow("duplicate");
  });

  it("marks a full page as truncated because more rows can exist", () => {
    const rows = Array.from({ length: SEO_SEARCH_QUERY_ROW_LIMIT }, (_, i) =>
      row([`query ${i}`, "https://www.example.test/"]),
    );
    expect(normalizeGscQueries(query, { rows }).truncated).toBe(true);
  });
});
