import { describe, expect, it } from "vitest";
import { privateMetricEpisode } from "./seo-private-recommendation-reviews";

const anchor = new Date("2026-06-08T03:00:00Z");
const baseline = {
  id: "old",
  from: "2026-06-01",
  to: "2026-06-07",
  at: new Date("2026-06-08T01:00:00Z"),
  dataset: "account/property",
  zone: "UTC",
  sessions: 100,
  engagement: 4000,
};
const changed = {
  ...baseline,
  id: "new",
  from: "2026-06-09",
  to: "2026-06-15",
  at: new Date("2026-06-16T12:00:00Z"),
  engagement: 2500,
};

describe("an action's organic landing measurements", () => {
  it("reports actual engagement seconds per organic session on either side of the decision", () => {
    expect(
      privateMetricEpisode(
        [baseline, changed],
        "engagement_changed",
        anchor,
        {},
      ),
    ).toMatchObject({
      before: 40,
      after: 25,
      baselineObservationId: "old",
      observationId: "new",
      afterPeriod: { sessions: 100 },
    });
  });
  it("rejects mismatched windows, weak samples, small changes and work completed after the measurement", () => {
    for (const data of [
      { sessions: 8 },
      { from: "2026-06-10" },
      { engagement: 3500 },
      { dataset: "other/property" },
      { to: "2026-06-07", from: "2026-06-01" },
    ]) {
      expect(
        privateMetricEpisode(
          [baseline, { ...changed, ...data }],
          "engagement_changed",
          anchor,
          {},
        ),
      ).toBeUndefined();
    }
    expect(
      privateMetricEpisode(
        [baseline, changed],
        "engagement_changed",
        new Date("2026-06-16T03:00:00Z"),
        {},
      ),
    ).toBeUndefined();
    expect(
      privateMetricEpisode(
        [baseline, changed],
        "purchase_rate_changed",
        anchor,
        {},
      ),
    ).toBeUndefined();
  });
});
