import { describe, expect, it } from "vitest";

import { getUsersByIdCreditsResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

function buildCreditsResponse(enterprise: unknown) {
  return {
    data: {
      subscription: {
        plan: "starter",
        status: "active",
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-02-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        credits: { total: 100, remaining: 57.5, used: 42.5 },
      },
      extra: {
        credits: { total: 25, remaining: 12.5, used: 12.5 },
        buckets: [
          {
            total: 25,
            remaining: 12.5,
            expiresAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        enterprise,
      },
      credits: {
        subscription: null,
        buffer: 12.5,
        total: 70,
      },
    },
    meta: {
      timestamp: "2026-01-01T00:00:00.000Z",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    },
  };
}

describe("getUsersByIdCreditsResponseTransformer", () => {
  it("handles a null extra.enterprise without throwing", async () => {
    const data = buildCreditsResponse(null);

    const result = await getUsersByIdCreditsResponseTransformer(
      structuredClone(data),
    );

    expect(result.data.extra.enterprise).toBeNull();
    expect(result.data.extra.buckets[0]?.expiresAt).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
    expect(result.meta.timestamp).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("transforms enterprise bucket dates when enterprise is present", async () => {
    const data = buildCreditsResponse({
      credits: { total: 40, remaining: 30, used: 10 },
      buckets: [
        {
          total: 40,
          remaining: 30,
          expiresAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    const result = await getUsersByIdCreditsResponseTransformer(
      structuredClone(data),
    );

    expect(result.data.extra.enterprise?.buckets[0]?.expiresAt).toEqual(
      new Date("2026-09-01T00:00:00.000Z"),
    );
  });
});
