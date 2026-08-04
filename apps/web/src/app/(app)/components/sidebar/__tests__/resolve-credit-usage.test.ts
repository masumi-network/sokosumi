import { describe, expect, it } from "vitest";

import { StripeSubscriptionStatus } from "@/lib/clients/generated/core";

import type { SidebarCreditsData } from "../index";
import { resolveCreditUsage } from "../index";

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
