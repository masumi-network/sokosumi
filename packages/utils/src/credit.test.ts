import { describe, expect, it } from "vitest";

import { convertCentsToCredits, convertCreditsToCents } from "./credit";

describe("convertCentsToCredits", () => {
  it("converts cents to credits", () => {
    expect(convertCentsToCredits(25_000_000_000n)).toBe(2.5);
  });

  it("supports values above Number.MAX_SAFE_INTEGER", () => {
    expect(convertCentsToCredits(10_000_000_000_000_000_000n)).toBe(
      1_000_000_000,
    );
  });
});

describe("convertCreditsToCents", () => {
  it("converts credits to cents", () => {
    expect(convertCreditsToCents(2.5)).toBe(25_000_000_000n);
  });

  it("rounds half up when more than 10 decimal places are provided", () => {
    expect(convertCreditsToCents(0.12345678905)).toBe(1_234_567_891n);
  });
});
