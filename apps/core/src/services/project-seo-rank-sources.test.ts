import { describe, expect, it } from "vitest";

import { seoRankPeriodWhere } from "./project-seo-rank-sources";
import { matchesSeoPeriod } from "./project-seo-store";

describe("rank history period in the query", () => {
  it("takes the same instants as the period check, to the millisecond at both ends", () => {
    const period = { from: "2026-03-10", to: "2026-03-12" };
    const where = seoRankPeriodWhere(period);
    for (const instant of [
      "2026-03-09T23:59:59.999Z",
      "2026-03-10T00:00:00.000Z",
      "2026-03-12T23:59:59.999Z",
      "2026-03-13T00:00:00.000Z",
    ]) {
      const at = new Date(instant);
      const inQuery =
        (!where?.gte || at >= where.gte) && (!where?.lt || at < where.lt);
      expect([instant, inQuery]).toEqual([
        instant,
        matchesSeoPeriod(at, period),
      ]);
    }
  });

  it("leaves an open end open", () => {
    expect(seoRankPeriodWhere({})).toBeUndefined();
    expect(seoRankPeriodWhere({ from: "2026-03-10" })).toEqual({
      gte: new Date("2026-03-10T00:00:00.000Z"),
    });
    expect(seoRankPeriodWhere({ to: "2026-12-31" })).toEqual({
      lt: new Date("2027-01-01T00:00:00.000Z"),
    });
  });
});
