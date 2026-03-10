import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  getCreditTopUpLookupKeyByCredits,
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
