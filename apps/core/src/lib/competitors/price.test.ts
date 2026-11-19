import { describe, expect, it } from "vitest";

import {
  COMPETITOR_CHECK_COST_USD,
  COMPETITOR_CHECK_CREDITS,
  competitorCheckCredits,
} from "./price";

describe("competitor check price", () => {
  it("is the measured cost plus half, rounded up to a whole credit", () => {
    // 0.7 + 0.3 + 2 x 0.2 = 1.4 cents; with the markup 2.1.
    expect(COMPETITOR_CHECK_CREDITS).toBe(3);
  });

  it("does not round a whole number of credits up", () => {
    expect(
      competitorCheckCredits({
        newsSearch: 0.01,
        newsSort: 0.006,
        pageChange: 0.002,
      }),
    ).toBe(3);
  });

  it("rises with what a call costs", () => {
    expect(
      competitorCheckCredits({
        ...COMPETITOR_CHECK_COST_USD,
        newsSearch: 0.014,
      }),
    ).toBe(4);
  });
});
