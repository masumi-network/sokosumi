import type { CreditCost } from "@sokosumi/database";
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
});
