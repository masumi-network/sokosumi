import { describe, expect, it } from "vitest";

import {
  buildSubscriptionWallPlans,
  resolveHermesHasActiveSubscription,
} from "@/app/personal-assistant/hermes-page-subscription";
import type { GetSubscriptionCatalogResponse } from "@/lib/clients/generated/core";

describe("resolveHermesHasActiveSubscription", () => {
  it("is false when no coverage and not admin (fail-closed)", () => {
    expect(resolveHermesHasActiveSubscription(false, "user")).toBe(false);
    expect(resolveHermesHasActiveSubscription(false, null)).toBe(false);
    expect(resolveHermesHasActiveSubscription(false, undefined)).toBe(false);
  });

  it("is true when coverage is true", () => {
    expect(resolveHermesHasActiveSubscription(true, "user")).toBe(true);
  });

  it("is true for platform admin even without coverage", () => {
    expect(resolveHermesHasActiveSubscription(false, "admin")).toBe(true);
    expect(resolveHermesHasActiveSubscription(false, "user,admin")).toBe(true);
  });
});

describe("buildSubscriptionWallPlans", () => {
  it("returns empty when catalog is missing", () => {
    expect(buildSubscriptionWallPlans(null)).toEqual([]);
    expect(buildSubscriptionWallPlans(undefined)).toEqual([]);
  });

  it("maps starter/standard/pro in product order", () => {
    const catalog = {
      data: {
        free: { credits: 250, currency: "eur", monthlyAmount: 0 },
        starter: { credits: 1_750, currency: "eur", monthlyAmount: 2_500 },
        standard: { credits: 5_250, currency: "eur", monthlyAmount: 7_500 },
        pro: { credits: 14_000, currency: "eur", monthlyAmount: 20_000 },
      },
    } as GetSubscriptionCatalogResponse;

    expect(buildSubscriptionWallPlans(catalog)).toEqual([
      {
        name: "starter",
        monthlyAmount: 2_500,
        currency: "eur",
        credits: 1_750,
      },
      {
        name: "standard",
        monthlyAmount: 7_500,
        currency: "eur",
        credits: 5_250,
      },
      {
        name: "pro",
        monthlyAmount: 20_000,
        currency: "eur",
        credits: 14_000,
      },
    ]);
  });
});
