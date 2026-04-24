import { describe, expect, it } from "vitest";

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
      total: 70,
      credits: {
        subscription,
        buffer: 12.5,
        total: 70,
      },
      extra: { buckets: [], remainingTotal: 0 },
    });

    expect(result.total).toBe(70);
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
      total: 20,
      credits: {
        subscription: null,
        buffer: 20,
        total: 20,
      },
      extra: { buckets: [], remainingTotal: 0 },
    });

    expect(result.subscription).toBeNull();
    expect(result.total).toBe(20);
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
    const result = creditsResponseSchema.parse({
      subscription: null,
      total: 5,
      credits: {
        subscription: null,
        buffer: 5,
        total: 5,
      },
      extra: {
        buckets: [
          {
            total: 10,
            remaining: 3.25,
            expiresAt: "2026-06-01T00:00:00.000Z",
          },
          { total: 2, remaining: 2, expiresAt: null },
        ],
        remainingTotal: 5.25,
      },
    });

    expect(result.extra.remainingTotal).toBe(5.25);
    expect(result.extra.buckets).toEqual([
      {
        total: 10,
        remaining: 3.25,
        expiresAt: "2026-06-01T00:00:00.000Z",
      },
      { total: 2, remaining: 2, expiresAt: null },
    ]);
  });
});
