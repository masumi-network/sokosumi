import { expect, it } from "vitest";
import {
  seoDeviceVerdict,
  seoPageVerdict,
  seoVitalStatus,
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
