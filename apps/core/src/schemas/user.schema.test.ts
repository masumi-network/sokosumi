import { describe, expect, it } from "vitest";

import * as userSchemas from "./user.schema";
import { creditsResponseSchema, userSchema } from "./user.schema";

describe("userSchema", () => {
  it("keeps role in the parsed user payload", () => {
    const result = userSchema.parse({
      id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      name: "John Doe",
      email: "john.doe@example.com",
      emailVerified: true,
      image: "https://example.com/image.png",
      role: "admin",
    });

    expect(result.role).toBe("admin");
  });

  it("does not export userOnboardingResponseSchema", () => {
    expect(userSchemas).not.toHaveProperty("userOnboardingResponseSchema");
  });
});

describe("creditsResponseSchema", () => {
  it("accepts subscription credits payload with credit buffer", () => {
    const subscription = {
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
    };
    const result = creditsResponseSchema.parse({
      subscription,
      extra: {
        credits: {
          total: 0,
          remaining: 0,
          used: 0,
        },
        buckets: [],
        enterprise: null,
      },
      credits: {
        subscription,
        buffer: 12.5,
        total: 70,
      },
    });

    expect(result.extra.credits.total).toBe(0);
    expect(result.extra.credits.remaining).toBe(0);
    expect(result.extra.credits.used).toBe(0);
    expect(result.extra.buckets).toEqual([]);
    expect(result.subscription?.credits).toEqual({
      total: 100,
      remaining: 57.5,
      used: 42.5,
    });
    expect(result.credits.buffer).toBe(12.5);
    expect(result.credits.total).toBe(70);
    expect(result.credits.subscription?.credits).toEqual({
      total: 100,
      remaining: 57.5,
      used: 42.5,
    });
  });

  it("accepts null subscription credits payload with credit buffer", () => {
    const result = creditsResponseSchema.parse({
      subscription: null,
      extra: {
        credits: {
          total: 0,
          remaining: 0,
          used: 0,
        },
        buckets: [],
        enterprise: null,
      },
      credits: {
        subscription: null,
        buffer: 20,
        total: 20,
      },
    });

    expect(result.subscription).toBeNull();
    expect(result.credits.subscription).toBeNull();
    expect(result.credits.buffer).toBe(20);
    expect(result.credits.total).toBe(20);
  });

  it("rejects legacy numeric credits shape", () => {
    expect(() =>
      creditsResponseSchema.parse({
        credits: 100,
      }),
    ).toThrow();
  });

  it("accepts extra.buckets with totals and optional expiry", () => {
    const bucketList = [
      {
        total: 10,
        remaining: 3.25,
        expiresAt: "2026-06-01T00:00:00.000Z",
      },
      { total: 2, remaining: 2, expiresAt: null },
    ];
    const result = creditsResponseSchema.parse({
      subscription: null,
      extra: {
        credits: {
          total: 12,
          remaining: 5.25,
          used: 6.75,
        },
        buckets: bucketList,
        enterprise: null,
      },
      credits: {
        subscription: null,
        buffer: 5,
        total: 5,
      },
    });

    expect(result.extra.buckets).toEqual([
      {
        total: 10,
        remaining: 3.25,
        expiresAt: "2026-06-01T00:00:00.000Z",
      },
      { total: 2, remaining: 2, expiresAt: null },
    ]);
  });

  it("accepts buckets with only non-expiring entries", () => {
    const result = creditsResponseSchema.parse({
      subscription: null,
      extra: {
        credits: {
          total: 2,
          remaining: 2,
          used: 0,
        },
        buckets: [{ total: 2, remaining: 2, expiresAt: null }],
        enterprise: null,
      },
      credits: {
        subscription: null,
        buffer: 5,
        total: 5,
      },
    });

    expect(result.extra.buckets).toEqual([
      { total: 2, remaining: 2, expiresAt: null },
    ]);
  });
});
