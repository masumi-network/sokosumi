import type { ProjectSeoActionImpact } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoActionImpactModel } from "./seo-action-impact-model";

const window = (clicks: number, impressions: number) => ({
  from: "2026-05-13",
  to: "2026-06-09",
  clicks,
  impressions,
  position: 5,
});
const impact = (
  values: Partial<ProjectSeoActionImpact>,
): ProjectSeoActionImpact => ({
  anchor: "2026-06-10",
  anchorKind: "completed",
  days: 28,
  state: "measured",
  before: window(29, 300),
  after: window(60, 450),
  ...values,
});

describe("seoActionImpactModel", () => {
  it("gives a percent only for a count that is high enough on both sides", () => {
    expect(seoActionImpactModel(impact({})).rows).toEqual([
      { metric: "clicks", before: 29, after: 60, percent: null },
      { metric: "impressions", before: 300, after: 450, percent: 50 },
      { metric: "position", before: 5, after: 5, percent: null },
    ]);
  });

  it("names the first day an unsettled comparison can be read", () => {
    const model = seoActionImpactModel(
      impact({ state: "too_early", after: null }),
    );
    // The after-window ends on 2026-07-08; Search Console settles it 3 days later.
    expect(model.readableFrom).toBe("2026-07-11");
    expect(model.rows[1]).toMatchObject({ after: null, percent: null });
  });
});
