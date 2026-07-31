import { type CreditCost, POSTGRES_BIGINT_MAX } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent";

const sampleCreditCosts: CreditCost[] = [
  {
    id: "cc_test",
    createdAt: new Date(),
    updatedAt: new Date(),
    unit: "lovelace",
    centsPerUnit: 1n,
  },
];

describe("calculateCentsFromMasumiAmountStrings", () => {
  it("rejects invalid amount strings", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "not-a-number", unit: "lovelace" }],
        sampleCreditCosts,
      ),
    ).toThrow();
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "0", unit: "lovelace" }],
        sampleCreditCosts,
      ),
    ).toThrow();
  });

  it("treats the registry's empty ADA asset as lovelace", () => {
    expect(
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "2000000", unit: "" }],
        sampleCreditCosts,
      ),
    ).toBe(2000000n);
  });

  it("rejects a single converted amount outside PostgreSQL BIGINT", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: POSTGRES_BIGINT_MAX.toString(), unit: "lovelace" }],
        [{ ...sampleCreditCosts[0], centsPerUnit: 2n }],
      ),
    ).toThrow("Credit amount exceeds supported range");
  });

  it("rejects a multi-asset total outside PostgreSQL BIGINT", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [
          { amount: POSTGRES_BIGINT_MAX.toString(), unit: "lovelace" },
          { amount: "1", unit: "token" },
        ],
        [
          ...sampleCreditCosts,
          { ...sampleCreditCosts[0], id: "cc_token", unit: "token" },
        ],
      ),
    ).toThrow("Credit amount exceeds supported range");
  });
});
