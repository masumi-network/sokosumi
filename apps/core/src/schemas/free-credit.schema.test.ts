import { describe, expect, it } from "vitest";

import { createFreeCreditGrantSchema } from "./free-credit.schema";

describe("createFreeCreditGrantSchema", () => {
  it("accepts a valid grant payload", () => {
    const result = createFreeCreditGrantSchema.parse({
      targetType: "user",
      targetId: "user_123",
      credits: 500,
      ttlDays: 30,
      referenceNote: "Billing issue",
    });

    expect(result.referenceNote).toBe("Billing issue");
  });

  it("normalizes blank referenceNote to null", () => {
    const result = createFreeCreditGrantSchema.parse({
      targetType: "user",
      targetId: "user_123",
      credits: 500,
      ttlDays: null,
      referenceNote: "   ",
    });

    expect(result.referenceNote).toBeNull();
  });

  it("rejects non-positive credits", () => {
    expect(() =>
      createFreeCreditGrantSchema.parse({
        targetType: "user",
        targetId: "user_123",
        credits: 0,
        ttlDays: null,
        referenceNote: null,
      }),
    ).toThrow();
  });

  it("rejects ttlDays above the admin maximum", () => {
    expect(() =>
      createFreeCreditGrantSchema.parse({
        targetType: "user",
        targetId: "user_123",
        credits: 500,
        ttlDays: 3651,
        referenceNote: null,
      }),
    ).toThrow();
  });
});
