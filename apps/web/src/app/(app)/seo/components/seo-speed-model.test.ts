import { expect, it } from "vitest";
import {
  seoDeviceReason,
  seoDeviceVerdict,
  seoPageTrend,
  seoPageVerdict,
  seoVitalStatus,
  seoVitalTrend,
} from "./seo-speed-model";
import {
  seoTestSpeedField as field,
  seoTestSpeedLab as lab,
  seoTestSpeedDevice,
} from "./seo-test-fixture";

it("counts a value on a limit as inside it", () => {
  expect(seoVitalStatus("lcp", 2500)).toBe("good");
  expect(seoVitalStatus("lcp", 2501)).toBe("needs_improvement");
  expect(seoVitalStatus("lcp", 4000)).toBe("needs_improvement");
  expect(seoVitalStatus("lcp", 4001)).toBe("poor");
  expect(seoVitalStatus("cls", 0.1)).toBe("good");
  expect(seoVitalStatus("inp", 501)).toBe("poor");
  expect(seoVitalStatus("inp", null)).toBe("too_little_data");
});

it("lets real visitors lead over a slow lab test", () => {
  const verdict = seoDeviceVerdict(
    seoTestSpeedDevice({
      field: field({ lcp: 2000, inp: 150, cls: 0.05 }, "origin"),
      lab: lab({ lcp: 7400, cls: 0 }),
    }),
  );
  expect(verdict).toMatchObject({
    source: "fieldOrigin",
    verdict: "pass",
    worst: "good",
  });
});

it("falls back to the lab test when Google measured no Core Web Vital for visitors", () => {
  const verdict = seoDeviceVerdict(
    seoTestSpeedDevice({
      field: field({ lcp: null, inp: null, cls: null }),
      lab: lab({ lcp: 4200, cls: 0.2 }),
    }),
  );
  expect(verdict).toMatchObject({
    source: "lab",
    verdict: "over",
    over: ["lcp", "cls"],
    worst: "poor",
  });
});

it("passes a page without INP data and keeps the gap in the vitals", () => {
  const verdict = seoDeviceVerdict(
    seoTestSpeedDevice({ field: field({ lcp: 2000, inp: null, cls: 0.05 }) }),
  );
  expect(verdict.verdict).toBe("pass");
  expect(verdict.vitals[1]).toEqual({
    metric: "inp",
    value: null,
    status: "too_little_data",
  });
});

it("gives no verdict without LCP", () => {
  const verdict = seoDeviceVerdict(
    seoTestSpeedDevice({ field: field({ lcp: null, inp: 100, cls: 0.05 }) }),
  );
  expect(verdict).toMatchObject({
    verdict: "unknown",
    worst: "too_little_data",
  });
});

it("puts a page over the limit when one device is over it", () => {
  const page = seoPageVerdict([
    seoTestSpeedDevice({ lab: lab({ lcp: 3000, cls: 0 }) }),
    seoTestSpeedDevice({
      device: "desktop",
      field: field({ lcp: 1200, inp: 80, cls: 0 }),
    }),
  ]);
  expect(page).toMatchObject({
    verdict: "over",
    over: ["lcp"],
    worst: "needs_improvement",
    source: "lab",
  });
});

const weeks = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];

it("reads a falling LCP as getting faster and breaks the line at a week without a value", () => {
  const trend = seoVitalTrend("lcp", {
    status: "comparable",
    weeks,
    lcp: [4200, null, 3900, 3000],
  });
  expect(trend).toMatchObject({
    chart: true,
    direction: "better",
    first: { week: "2026-10-04", value: 4200 },
    last: { week: "2026-10-25", value: 3000 },
  });
  if (!trend.chart) return;
  expect(trend.points.map(({ y }) => y === null)).toEqual([
    false,
    true,
    false,
    false,
  ]);
  // The first week has no neighbor with a value: the chart draws it as a dot.
  expect(trend.points.map(({ alone }) => alone)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  // The slow first week is higher in the chart than the last one, and the limit is under both.
  expect(trend.points[0].y).toBeLessThan(trend.points[3].y ?? 0);
  expect(trend.limit).toBeGreaterThan(trend.points[3].y ?? 1);
  expect(trend.limit).toBeLessThan(1);
});

it("keeps the limit line inside the chart when every week is far under it", () => {
  const trend = seoVitalTrend("cls", {
    status: "comparable",
    weeks,
    cls: [0.01, 0.01, 0.01, 0.01],
  });
  expect(trend).toMatchObject({ chart: true, direction: "steady" });
  if (trend.chart) expect(trend.limit).toBeGreaterThan(0);
});

it("calls a small change steady and a slower INP worse", () => {
  const history = {
    status: "comparable" as const,
    weeks,
    lcp: [2000, 2100, 2050, 2150],
    inp: [180, 200, 240, 260],
  };
  expect(seoVitalTrend("lcp", history)).toMatchObject({ direction: "steady" });
  expect(seoVitalTrend("inp", history)).toMatchObject({ direction: "worse" });
  expect(
    seoPageTrend([seoTestSpeedDevice({ field: { ...field(), history } })]),
  ).toBe("worse");
});

it("gives a reason and no chart for one week or for weeks that cannot be compared", () => {
  expect(
    seoVitalTrend("lcp", {
      status: "comparable",
      weeks,
      lcp: [null, null, null, 2400],
    }),
  ).toEqual({ chart: false, reason: "too_few" });
  expect(seoVitalTrend("lcp", { status: "incompatible_population" })).toEqual({
    chart: false,
    reason: "incompatible_population",
  });
});

it("names no share of visitors when Google gave no device mix", () => {
  const check = {
    device: "mobile" as const,
    basis: "crux-url" as const,
    notChecked: null,
  };
  expect(seoDeviceReason({ ...check, mix: null }).basis).toBe("default");
  expect(
    seoDeviceReason({
      ...check,
      mix: {
        level: "url",
        phone: 0.72,
        desktop: 0.25,
        tablet: 0.03,
        period: null,
      },
    }),
  ).toEqual({ basis: "crux-url", share: 0.72 });
});
