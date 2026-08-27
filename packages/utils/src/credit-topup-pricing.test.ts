import { describe, expect, it } from "vitest";

import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  type CreditTopUpTier,
  getCreditTopUpLookupKeyByCredits,
  getCreditTopUpTotalMinorUnits,
  HIGH_CREDIT_TOPUP_LOOKUP_KEY,
  MID_CREDIT_TOPUP_LOOKUP_KEY,
  STANDARD_CREDIT_TOPUP_TIERS,
  selectCreditTopUpTier,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "./credit-topup-pricing.js";

describe("credit-topup-pricing", () => {
  it("selects lookup keys by credit volume", () => {
    expect(getCreditTopUpLookupKeyByCredits(9_999)).toBe(
      BASE_CREDIT_TOPUP_LOOKUP_KEY,
    );
    expect(getCreditTopUpLookupKeyByCredits(10_000)).toBe(
      MID_CREDIT_TOPUP_LOOKUP_KEY,
    );
    expect(getCreditTopUpLookupKeyByCredits(100_000)).toBe(
      HIGH_CREDIT_TOPUP_LOOKUP_KEY,
    );
  });

  it("honors lookup key overrides", () => {
    expect(
      getCreditTopUpLookupKeyByCredits(1, ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY),
    ).toBe(ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY);
  });

  it("computes total minor units", () => {
    expect(getCreditTopUpTotalMinorUnits(100, 1.2)).toBe(120);
  });
});

describe("selectCreditTopUpTier", () => {
  const tiers: CreditTopUpTier[] = [
    { minCredits: 1, amountPerCredit: 120 },
    { minCredits: 10_000, amountPerCredit: 115 },
    { minCredits: 100_000, amountPerCredit: 110 },
  ];

  it("selects the base tier below the first breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 5_000).amountPerCredit).toBe(120);
  });

  it("selects the mid tier at the first breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 10_000).amountPerCredit).toBe(115);
  });

  it("selects the high tier at the second breakpoint", () => {
    expect(selectCreditTopUpTier(tiers, 100_000).amountPerCredit).toBe(110);
  });

  it("handles unsorted tiers", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(selectCreditTopUpTier(shuffled, 50_000).amountPerCredit).toBe(115);
  });

  it("throws on non-positive-integer credits", () => {
    expect(() => selectCreditTopUpTier(tiers, 0)).toThrow();
    expect(() => selectCreditTopUpTier(tiers, 1.5)).toThrow();
  });
});

describe("STANDARD_CREDIT_TOPUP_TIERS", () => {
  it("maps the three standard breakpoints to lookup keys in ascending order", () => {
    expect(STANDARD_CREDIT_TOPUP_TIERS.map((t) => t.minCredits)).toEqual([
      1, 10_000, 100_000,
    ]);
  });
});
