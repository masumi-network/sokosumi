import { describe, expect, it } from "vitest";
import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  getCreditTopUpLookupKeyByCredits,
  getCreditTopUpTotalMinorUnits,
  isPositiveIntegerCredits,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "../credit-topup-pricing";

describe("credit-topup-pricing", () => {
  it("resolves lookup keys for boundary values", () => {
    expect(getCreditTopUpLookupKeyByCredits(1)).toBe("credit_20_margin");
    expect(getCreditTopUpLookupKeyByCredits(9_999)).toBe("credit_20_margin");
    expect(getCreditTopUpLookupKeyByCredits(10_000)).toBe("credit_15_margin");
    expect(getCreditTopUpLookupKeyByCredits(99_999)).toBe("credit_15_margin");
    expect(getCreditTopUpLookupKeyByCredits(100_000)).toBe("credit_10_margin");
  });

  it("exports the base lookup key for coupon checkout", () => {
    expect(BASE_CREDIT_TOPUP_LOOKUP_KEY).toBe("credit_20_margin");
  });

  it("uses the provided lookup key override for every valid amount", () => {
    expect(
      getCreditTopUpLookupKeyByCredits(1, ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY),
    ).toBe("credit_0_margin");
    expect(
      getCreditTopUpLookupKeyByCredits(
        10_000,
        ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
      ),
    ).toBe("credit_0_margin");
    expect(
      getCreditTopUpLookupKeyByCredits(
        250_000,
        ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
      ),
    ).toBe("credit_0_margin");
  });

  it("computes top-up total minor units with ceiling rounding", () => {
    expect(getCreditTopUpTotalMinorUnits(100, 1.2)).toBe(120);
    expect(getCreditTopUpTotalMinorUnits(1, 115)).toBe(115);
  });

  it("rejects invalid top-up totals", () => {
    expect(() => getCreditTopUpTotalMinorUnits(Number.NaN, 100)).toThrow(
      "Computed credit top-up total is invalid",
    );
    expect(() => getCreditTopUpTotalMinorUnits(100, Number.NaN)).toThrow(
      "Computed credit top-up total is invalid",
    );
    expect(() => getCreditTopUpTotalMinorUnits(0, 100)).toThrow(
      "Computed credit top-up total is invalid",
    );
  });

  it("rejects invalid credit amounts", () => {
    expect(isPositiveIntegerCredits(0)).toBe(false);
    expect(isPositiveIntegerCredits(-1)).toBe(false);
    expect(isPositiveIntegerCredits(1.5)).toBe(false);
    expect(isPositiveIntegerCredits(Number.NaN)).toBe(false);
    expect(isPositiveIntegerCredits(Number.POSITIVE_INFINITY)).toBe(false);

    expect(() => getCreditTopUpLookupKeyByCredits(0)).toThrow(
      "Credits must be a positive integer",
    );
    expect(() => getCreditTopUpLookupKeyByCredits(-1)).toThrow(
      "Credits must be a positive integer",
    );
    expect(() => getCreditTopUpLookupKeyByCredits(1.5)).toThrow(
      "Credits must be a positive integer",
    );
    expect(() => getCreditTopUpLookupKeyByCredits(Number.NaN)).toThrow(
      "Credits must be a positive integer",
    );
  });
});
