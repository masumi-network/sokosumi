import { describe, expect, it } from "vitest";

import {
  budgetStep,
  currencyFractionDigits,
  hasValidPrecision,
} from "./campaign";

describe("ad budget precision", () => {
  it.each([
    ["USD", 2, "0.01", 12.34, true],
    ["USD", 2, "0.01", 12.345, false],
    ["JPY", 0, "1", 500, true],
    ["JPY", 0, "1", 500.5, false],
  ])("%s allows %i decimals", (currency, digits, step, value, valid) => {
    expect(currencyFractionDigits(currency)).toBe(digits);
    expect(budgetStep(digits)).toBe(step);
    expect(hasValidPrecision(value, digits)).toBe(valid);
  });
});
