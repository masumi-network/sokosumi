import { describe, expect, it } from "vitest";

import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  getCreditTopUpLookupKeyByCredits,
  getCreditTopUpTotalMinorUnits,
  HIGH_CREDIT_TOPUP_LOOKUP_KEY,
  MID_CREDIT_TOPUP_LOOKUP_KEY,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "../credit-topup-pricing.js";

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
