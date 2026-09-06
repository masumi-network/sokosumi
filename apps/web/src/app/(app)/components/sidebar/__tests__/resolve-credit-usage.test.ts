import { describe, expect, it } from "vitest";

import { StripeSubscriptionStatus } from "@/lib/clients/generated/core";

import type { SidebarCreditsData } from "../index";
import { mapAccountCreditsChrome, resolveCreditUsage } from "../index";

function buildCreditsData(
  subscriptionCredits: NonNullable<
    NonNullable<SidebarCreditsData["subscription"]>["credits"]
  > | null = {
    total: 100,
    used: 25,
    remaining: 75,
  },
): SidebarCreditsData {
  return {
    total: 100,
    buffer: 0,
    subscription: {
      plan: "pro",
      status: StripeSubscriptionStatus.ACTIVE,
      periodEnd: null,
      credits: subscriptionCredits,
    },
  };
}

describe("resolveCreditUsage", () => {
  it("returns null when credits data is missing", () => {
    expect(resolveCreditUsage(null)).toBeNull();
  });

  it("returns null when subscription credits total is zero", () => {
    expect(
      resolveCreditUsage(buildCreditsData({ total: 0, used: 0, remaining: 0 })),
    ).toBeNull();
  });

  it("returns null when subscription credits are null", () => {
    expect(resolveCreditUsage(buildCreditsData(null))).toBeNull();
  });

  it("maps subscription credits into chip usage", () => {
    expect(resolveCreditUsage(buildCreditsData())).toEqual({
      percentageUsed: 25,
      remaining: 75,
      total: 100,
      used: 25,
    });
  });
});

describe("mapAccountCreditsChrome", () => {
  it("maps a missing credits fetch to free-plan chrome with no plan label", () => {
    expect(mapAccountCreditsChrome(null)).toEqual({
      creditsData: null,
      currentPlan: "free",
      planForLabel: null,
      buyCreditsPath: "/billing?tab=subscription",
      currentTimestampMs: 0,
      subscriptionPeriodEndMs: null,
      totalCredits: null,
      creditUsage: null,
    });
  });

  it("maps a credits payload into chip fields and timestamps", () => {
    const periodEnd = new Date("2026-09-01T00:00:00.000Z");
    const timestamp = new Date("2026-08-13T12:00:00.000Z");
    const creditsData = {
      ...buildCreditsData(),
      buffer: 10,
      subscription: {
        ...buildCreditsData().subscription!,
        periodEnd,
      },
    };

    expect(
      mapAccountCreditsChrome({
        data: {
          subscription: creditsData.subscription,
          extra: {
            credits: { total: 10, remaining: 10, used: 0 },
            buckets: [],
            enterprise: null,
          },
          credits: creditsData,
        },
        meta: {
          timestamp,
          requestId: "req-1",
        },
      }),
    ).toEqual({
      creditsData,
      currentPlan: "pro",
      planForLabel: "pro",
      buyCreditsPath: "/billing?tab=credits",
      currentTimestampMs: timestamp.getTime(),
      subscriptionPeriodEndMs: periodEnd.getTime(),
      totalCredits: 100,
      creditUsage: {
        percentageUsed: 25,
        remaining: 75,
        total: 100,
        used: 25,
      },
    });
  });
});
