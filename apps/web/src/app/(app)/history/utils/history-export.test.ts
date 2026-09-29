import { describe, expect, it } from "vitest";

import {
  buildExportHref,
  lastDaysRange,
  monthRange,
  namedMonthRange,
} from "./history-export";

const NOW = new Date("2026-09-28T15:00:00Z");

describe("history export ranges", () => {
  it("last month is the whole previous calendar month", () => {
    expect(monthRange(NOW, 1)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("last month across a year boundary", () => {
    expect(monthRange(new Date("2026-01-10T00:00:00Z"), 1)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("this month runs to its own last day", () => {
    expect(monthRange(NOW, 0)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("a leap February ends on the 29th", () => {
    expect(namedMonthRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("rejects a month value that is not YYYY-MM", () => {
    expect(namedMonthRange("")).toBeNull();
    expect(namedMonthRange("2026-9")).toBeNull();
  });

  it("last 30 days counts today as one of them", () => {
    expect(lastDaysRange(NOW, 30)).toEqual({
      from: "2026-08-30",
      to: "2026-09-28",
    });
  });

  it("carries the list's filters into the download link", () => {
    const href = buildExportHref(
      { from: "2026-09-01", to: "2026-09-30" },
      { q: "a&b", scope: "workspace", type: "job", projectId: null },
    );

    expect(href).toBe(
      "/api/transactions/export?from=2026-09-01&to=2026-09-30&q=a%26b&scope=workspace&types=job",
    );
  });
});
