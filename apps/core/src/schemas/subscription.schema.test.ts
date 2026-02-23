import { describe, expect, it } from "vitest";

import { subscriptionSchema } from "./subscription.schema";

describe("subscriptionSchema", () => {
  it("accepts subscription credits as an object", () => {
    const result = subscriptionSchema.parse({
      id: "sub_123",
      plan: "starter",
      status: "active",
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2025-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      credits: {
        total: 100,
        remaining: 57.5,
        used: 42.5,
      },
    });

    expect(result.credits).toEqual({
      total: 100,
      remaining: 57.5,
      used: 42.5,
    });
  });

  it("accepts subscription credits as null", () => {
    const result = subscriptionSchema.parse({
      id: "sub_123",
      plan: "starter",
      status: "active",
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2025-02-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      credits: null,
    });

    expect(result.credits).toBeNull();
  });

  it("rejects subscription credits when field is missing", () => {
    expect(() =>
      subscriptionSchema.parse({
        id: "sub_123",
        plan: "starter",
        status: "active",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      }),
    ).toThrow();
  });
});
