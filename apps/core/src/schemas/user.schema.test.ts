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
    const result = creditsResponseSchema.parse({
      credits: {
        subscription: {
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
        },
        extra: {
          available: 12.5,
          total: 20,
        },
        buffer: 12.5,
        total: 70,
      },
    });

    expect(result.credits.extra).toEqual({
      available: 12.5,
      total: 20,
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
      credits: {
        subscription: null,
        extra: {
          available: 20,
          total: 20,
        },
        buffer: 20,
        total: 20,
      },
    });

    expect(result.credits.subscription).toBeNull();
    expect(result.credits.extra).toEqual({
      available: 20,
      total: 20,
    });
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
});
