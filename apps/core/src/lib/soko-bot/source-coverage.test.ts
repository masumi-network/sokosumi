import { describe, expect, it } from "vitest";
import { buildSourceCoverage } from "./source-coverage";

const query = {
  source: "calendar",
  checkedAt: "2026-09-26T00:00:00.000Z",
  filters: {
    start: "2026-09-26",
    end: "2026-09-27",
    timezone: "Europe/Vienna",
  },
  scannedCount: 0,
  includedCount: 0,
  omittedCount: 0,
  completeness: "COMPLETE" as const,
  availability: "AVAILABLE" as const,
};
describe("source coverage", () => {
  it("distinguishes a complete empty query from an unavailable source", () => {
    expect(buildSourceCoverage(query)).toMatchObject({
      completeness: "COMPLETE",
      availability: "AVAILABLE",
      includedCount: 0,
    });
    for (const availability of [
      "DISCONNECTED",
      "PERMISSION_DENIED",
      "QUERY_FAILED",
      "NOT_FETCHED",
    ] as const) {
      expect(buildSourceCoverage({ ...query, availability })).toMatchObject({
        availability,
        completeness: "NOT_CHECKED",
      });
    }
  });
  it("reports omitted records as truncated while preserving the exact authorized window", () => {
    expect(
      buildSourceCoverage({
        ...query,
        scannedCount: 30,
        includedCount: 20,
        omittedCount: 10,
      }),
    ).toMatchObject({
      completeness: "TRUNCATED",
      filters: query.filters,
      scannedCount: 30,
      includedCount: 20,
      omittedCount: 10,
    });
  });
});
