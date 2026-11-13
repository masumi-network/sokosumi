import { describe, expect, it } from "vitest";

import {
  meanConfidenceInterval,
  rateConfidenceInterval,
  spearmanCorrelation,
} from "./ad-evals-statistics";

describe("Spearman correlation", () => {
  it("recognizes increasing and reversed rankings", () => {
    expect(
      spearmanCorrelation([
        [1, 3],
        [2, 7],
        [3, 9],
      ]),
    ).toBe(1);
    expect(
      spearmanCorrelation([
        [1, 9],
        [2, 7],
        [3, 3],
      ]),
    ).toBe(-1);
  });

  it("uses average ranks for tied thumbs", () => {
    expect(
      spearmanCorrelation([
        [1, -1],
        [2, -1],
        [3, 1],
        [4, 1],
      ]),
    ).toBeCloseTo(0.894427);
  });

  it("returns no correlation for empty, singleton, or constant labels", () => {
    expect(spearmanCorrelation([])).toBeNull();
    expect(spearmanCorrelation([[1, 1]])).toBeNull();
    expect(
      spearmanCorrelation([
        [1, 1],
        [5, 1],
      ]),
    ).toBeNull();
    expect(
      spearmanCorrelation([
        [2, -1],
        [2, 1],
      ]),
    ).toBeNull();
  });

  it("excludes non-finite observations", () => {
    expect(
      spearmanCorrelation([
        [1, 1],
        [2, 2],
        [Number.NaN, 3],
      ]),
    ).toBe(1);
  });
});

describe("95% confidence intervals", () => {
  it("keeps Wilson bounds nonzero-width for unanimous ratings", () => {
    expect(rateConfidenceInterval(0, 0)).toBeNull();
    expect(rateConfidenceInterval(5, 5)).toEqual({
      lower: expect.any(Number),
      upper: 1,
    });
    expect(rateConfidenceInterval(5, 5)?.lower).toBeCloseTo(0.5655, 3);
    expect(rateConfidenceInterval(0, 5)?.upper).toBeCloseTo(0.4345, 3);
  });

  it("returns no mean interval for one score and clips it to the judge scale", () => {
    expect(meanConfidenceInterval([3])).toBeNull();
    expect(meanConfidenceInterval([1, 5])).toEqual({ lower: 1, upper: 5 });
    expect(meanConfidenceInterval([4, 4, 4])).toEqual({ lower: 4, upper: 4 });
  });
});
