import type { ProjectSeoActionImpact } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  missesFreshSeoActionImpact,
  seoActionImpactModel,
  withFreshSeoActionImpact,
} from "./seo-action-impact-model";

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

describe("withFreshSeoActionImpact", () => {
  it("gives a cached action the fresh impact and keeps the rest of the cached list", () => {
    const action = (id: string, values?: Partial<ProjectSeoActionImpact>) => ({
      observationId: "audit",
      id,
      title: "cached",
      ...(values && { impact: impact(values) }),
    });
    const fresh = [
      { ...action("a", { days: 7 }), title: "fresh" },
      action("b"),
      { ...action("c", { days: 7 }), observationId: "other" },
    ];
    expect(
      withFreshSeoActionImpact(
        [action("a"), action("b", {}), action("c")],
        fresh,
      ),
    ).toEqual([action("a", { days: 7 }), action("b", {}), action("c")]);
  });
});

describe("missesFreshSeoActionImpact", () => {
  it("names a view whose done action the fresh read does not hold", () => {
    const done = {
      observationId: "older",
      id: "a",
      completedAt: "2026-06-10T00:00:00Z",
    };
    const open = { observationId: "older", id: "b" };
    expect(missesFreshSeoActionImpact([done], [])).toBe(true);
    expect(missesFreshSeoActionImpact([done], [done])).toBe(false);
    // An open action has no impact to miss.
    expect(missesFreshSeoActionImpact([open], [])).toBe(false);
  });
});

describe("seoActionImpactModel", () => {
  it("gives a percent only for a count that is high enough on both sides", () => {
    expect(seoActionImpactModel(impact({})).rows).toEqual([
      { metric: "clicks", before: 29, after: 60, percent: null },
      { metric: "impressions", before: 300, after: 450, percent: 50 },
      { metric: "position", before: 5, after: 5, percent: null },
    ]);
  });

  it("flags a low count of clicks too, and only when both sides were read", () => {
    // Core's state looks at impressions alone: 29 clicks leave the clicks row without a percent.
    expect(seoActionImpactModel(impact({})).lowCounts).toBe(true);
    expect(
      seoActionImpactModel(impact({ before: window(30, 300) })).lowCounts,
    ).toBe(false);
    expect(
      seoActionImpactModel(impact({ state: "too_early", after: null }))
        .lowCounts,
    ).toBe(false);
  });

  it("flags a missing before side of a too-early comparison as not measured", () => {
    const early = { state: "too_early", after: null } as const;
    expect(seoActionImpactModel(impact(early)).notMeasured).toBe(false);
    expect(
      seoActionImpactModel(impact({ ...early, before: null })).notMeasured,
    ).toBe(true);
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
