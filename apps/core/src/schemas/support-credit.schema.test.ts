import { describe, expect, it } from "vitest";

import { createSupportCreditGrantSchema } from "./support-credit.schema";

const baseInput = {
  targetType: "user" as const,
  targetId: "user_123",
  credits: 500,
  ttlDays: null,
};

describe("createSupportCreditGrantSchema", () => {
  it("trims referenceNote and rejects whitespace-only values", () => {
    const result = createSupportCreditGrantSchema.parse({
      ...baseInput,
      referenceNote: "  billing issue  ",
    });

    expect(result.referenceNote).toBe("billing issue");
  });

  it("normalizes blank referenceNote to null", () => {
    const result = createSupportCreditGrantSchema.parse({
      ...baseInput,
      referenceNote: "   ",
    });

    expect(result.referenceNote).toBeNull();
  });

  it("rejects referenceNote longer than 500 characters after trim", () => {
    expect(() => {
      createSupportCreditGrantSchema.parse({
        ...baseInput,
        referenceNote: ` ${"a".repeat(501)} `,
      });
    }).toThrow();
  });
});
