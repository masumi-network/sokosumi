import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  convertCreditsToStripeUnits,
  convertStripeUnitsToCredits,
  getCreditTopUpLookupKeyByCredits,
  isPositiveIntegerCredits,
  isStripeUnitAlignedCredits,
  TOPUP_CREDITS_PER_STRIPE_UNIT,
} from "../credit-topup-pricing";

describe("credit-topup-pricing", () => {
  it("resolves lookup keys for boundary values", () => {
    expect(getCreditTopUpLookupKeyByCredits(1)).toBe("credit_20_margin");
    expect(getCreditTopUpLookupKeyByCredits(10_000)).toBe("credit_20_margin");
    expect(getCreditTopUpLookupKeyByCredits(10_001)).toBe("credit_15_margin");
    expect(getCreditTopUpLookupKeyByCredits(100_000)).toBe("credit_15_margin");
    expect(getCreditTopUpLookupKeyByCredits(100_001)).toBe("credit_10_margin");
  });

  it("exports the base lookup key for coupon checkout", () => {
    expect(BASE_CREDIT_TOPUP_LOOKUP_KEY).toBe("credit_20_margin");
  });

  it("exports the Stripe unit conversion ratio", () => {
    expect(TOPUP_CREDITS_PER_STRIPE_UNIT).toBe(100);
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

  it("checks Stripe unit alignment for credit amounts", () => {
    expect(isStripeUnitAlignedCredits(100)).toBe(true);
    expect(isStripeUnitAlignedCredits(10_000)).toBe(true);
    expect(isStripeUnitAlignedCredits(100_100)).toBe(true);

    expect(isStripeUnitAlignedCredits(1)).toBe(false);
    expect(isStripeUnitAlignedCredits(150)).toBe(false);
    expect(isStripeUnitAlignedCredits(0)).toBe(false);
    expect(isStripeUnitAlignedCredits(100.5)).toBe(false);
  });

  it("converts aligned credits to Stripe units", () => {
    expect(convertCreditsToStripeUnits(100)).toBe(1);
    expect(convertCreditsToStripeUnits(10_000)).toBe(100);
    expect(convertCreditsToStripeUnits(100_100)).toBe(1001);
  });

  it("throws when converting invalid credits to Stripe units", () => {
    expect(() => convertCreditsToStripeUnits(1)).toThrow(
      "Credits must be a positive integer multiple of 100",
    );
    expect(() => convertCreditsToStripeUnits(150)).toThrow(
      "Credits must be a positive integer multiple of 100",
    );
    expect(() => convertCreditsToStripeUnits(0)).toThrow(
      "Credits must be a positive integer multiple of 100",
    );
    expect(() => convertCreditsToStripeUnits(100.5)).toThrow(
      "Credits must be a positive integer multiple of 100",
    );
  });

  it("converts Stripe units back to credits", () => {
    expect(convertStripeUnitsToCredits(0)).toBe(0);
    expect(convertStripeUnitsToCredits(1)).toBe(100);
    expect(convertStripeUnitsToCredits(3)).toBe(300);
  });
});
