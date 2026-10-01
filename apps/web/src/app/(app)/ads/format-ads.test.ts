import { describe, expect, it } from "vitest";

import {
  budgetStep,
  currencyFractionDigits,
  formatCount,
  formatMoney,
  formatPercent,
  hasValidPrecision,
  NO_VALUE,
} from "./format-ads";

describe("formatMoney", () => {
  it("formats in the account currency", () => {
    expect(formatMoney(1234.5, "USD", "en")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "EUR", "de")).toBe("1.234,50\u00a0€");
  });

  it("uses no decimals for currencies without them", () => {
    expect(formatMoney(1500, "JPY", "en")).toBe("¥1,500");
  });

  it("shows a dash for null", () => {
    expect(formatMoney(null, "USD", "en")).toBe(NO_VALUE);
  });
});

describe("formatPercent", () => {
  it("shows the CTR fraction as a percentage", () => {
    expect(formatPercent(0.0123, "en")).toBe("1.23%");
    expect(formatPercent(0, "en")).toBe("0%");
  });

  it("shows a dash for null", () => {
    expect(formatPercent(null, "en")).toBe(NO_VALUE);
  });
});

describe("formatCount", () => {
  it("groups thousands and keeps one decimal at most", () => {
    expect(formatCount(12345, "en")).toBe("12,345");
    expect(formatCount(2.55, "en")).toBe("2.6");
  });

  it("shows a dash for null", () => {
    expect(formatCount(null, "en")).toBe(NO_VALUE);
  });
});

describe("budget precision", () => {
  it("reads the decimal places from the currency", () => {
    expect(currencyFractionDigits("USD", "en")).toBe(2);
    expect(currencyFractionDigits("JPY", "en")).toBe(0);
  });

  it("steps by the smallest unit", () => {
    expect(budgetStep("USD", "en")).toBe("0.01");
    expect(budgetStep("JPY", "en")).toBe("1");
  });

  it("rejects more decimals than the currency allows", () => {
    expect(hasValidPrecision(10.5, 2)).toBe(true);
    expect(hasValidPrecision(10.005, 2)).toBe(false);
    expect(hasValidPrecision(10.5, 0)).toBe(false);
    expect(hasValidPrecision(1000, 0)).toBe(true);
  });
});
