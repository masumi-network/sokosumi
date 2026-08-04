import { describe, expect, it } from "vitest";

import {
  aggregateMasumiPaymentAmounts,
  doMasumiPaymentAmountsMatch,
  normalizeMasumiPaymentUnit,
} from "../payment-amounts.js";

const TOKEN_UNIT = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde";

describe("normalizeMasumiPaymentUnit", () => {
  it("maps both ADA spellings onto lovelace", () => {
    expect(normalizeMasumiPaymentUnit("")).toBe("lovelace");
    expect(normalizeMasumiPaymentUnit("lovelace")).toBe("lovelace");
    expect(normalizeMasumiPaymentUnit("Lovelace")).toBe("lovelace");
  });

  it("leaves asset units untouched", () => {
    expect(normalizeMasumiPaymentUnit(TOKEN_UNIT)).toBe(TOKEN_UNIT);
  });
});

describe("aggregateMasumiPaymentAmounts", () => {
  it("sums duplicate units after normalization", () => {
    expect(
      aggregateMasumiPaymentAmounts([
        { amount: "100", unit: "" },
        { amount: "250", unit: "lovelace" },
        { amount: "7", unit: TOKEN_UNIT },
      ]),
    ).toEqual(
      new Map([
        ["lovelace", 350n],
        [TOKEN_UNIT, 7n],
      ]),
    );
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(
      aggregateMasumiPaymentAmounts([
        { amount: "9007199254740993", unit: "lovelace" },
      ])?.get("lovelace"),
    ).toBe(9007199254740993n);
  });

  it("rejects payloads it cannot compare", () => {
    expect(aggregateMasumiPaymentAmounts(undefined)).toBeNull();
    expect(aggregateMasumiPaymentAmounts(null)).toBeNull();
    expect(aggregateMasumiPaymentAmounts({ amount: "1", unit: "" })).toBeNull();
    // Numeric (not string) amount, negative, decimal and non-numeric values are
    // all refused rather than silently coerced.
    expect(aggregateMasumiPaymentAmounts([{ amount: 1, unit: "" }])).toBeNull();
    expect(
      aggregateMasumiPaymentAmounts([{ amount: "-1", unit: "" }]),
    ).toBeNull();
    expect(
      aggregateMasumiPaymentAmounts([{ amount: "1.5", unit: "" }]),
    ).toBeNull();
    expect(aggregateMasumiPaymentAmounts([{ amount: "1" }])).toBeNull();
  });

  it("treats an empty array as an empty total set", () => {
    expect(aggregateMasumiPaymentAmounts([])).toEqual(new Map());
  });
});

describe("doMasumiPaymentAmountsMatch", () => {
  it("matches regardless of ADA spelling, order and per-unit splitting", () => {
    expect(
      doMasumiPaymentAmountsMatch(
        [
          { amount: "1000000", unit: "" },
          { amount: "5", unit: TOKEN_UNIT },
        ],
        [
          { amount: "5", unit: TOKEN_UNIT },
          { amount: "400000", unit: "lovelace" },
          { amount: "600000", unit: "lovelace" },
        ],
      ),
    ).toBe(true);
  });

  it("rejects a drifted amount", () => {
    expect(
      doMasumiPaymentAmountsMatch(
        [{ amount: "1000000", unit: "lovelace" }],
        [{ amount: "1000001", unit: "lovelace" }],
      ),
    ).toBe(false);
  });

  it("rejects an extra or missing unit", () => {
    expect(
      doMasumiPaymentAmountsMatch(
        [{ amount: "1000000", unit: "lovelace" }],
        [
          { amount: "1000000", unit: "lovelace" },
          { amount: "1", unit: TOKEN_UNIT },
        ],
      ),
    ).toBe(false);
    expect(
      doMasumiPaymentAmountsMatch(
        [
          { amount: "1000000", unit: "lovelace" },
          { amount: "1", unit: TOKEN_UNIT },
        ],
        [{ amount: "1000000", unit: "lovelace" }],
      ),
    ).toBe(false);
  });

  it("never matches when either side is unparseable", () => {
    expect(doMasumiPaymentAmountsMatch([{ amount: "1", unit: "" }], null)).toBe(
      false,
    );
    expect(
      doMasumiPaymentAmountsMatch(undefined, [{ amount: "1", unit: "" }]),
    ).toBe(false);
    // Two unparseable sides must not compare equal either.
    expect(doMasumiPaymentAmountsMatch(null, null)).toBe(false);
  });
});
