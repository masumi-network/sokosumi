import { describe, expect, it } from "vitest";

import {
  getPlanTranslationKey,
  hasSelectablePaidPlan,
  type PaidSubscriptionPlanView,
  parsePlanName,
  resolveInitialSelectedPlan,
} from "@/components/billing/subscription-plan-utils";

function plan(
  name: PaidSubscriptionPlanView["name"],
  isCurrent = false,
): PaidSubscriptionPlanView {
  return {
    credits: 100,
    currency: "usd",
    isCurrent,
    monthlyAmount: 10,
    name,
  };
}

describe("subscription-plan-utils", () => {
  it("parses self-serve plan names", () => {
    expect(parsePlanName("starter")).toBe("starter");
    expect(parsePlanName("Pro")).toBe("pro");
  });

  it("returns translation keys for subscription plans", () => {
    expect(getPlanTranslationKey("starter")).toBe("starter");
    expect(getPlanTranslationKey("pro")).toBe("pro");
    expect(getPlanTranslationKey("enterprise")).toBe("enterprise");
  });

  describe("resolveInitialSelectedPlan", () => {
    it("prefers standard when it is selectable", () => {
      expect(
        resolveInitialSelectedPlan([
          plan("starter"),
          plan("standard"),
          plan("pro"),
        ]),
      ).toBe("standard");
    });

    it("skips the current plan and falls back to the first selectable", () => {
      expect(
        resolveInitialSelectedPlan([
          plan("standard", true),
          plan("pro"),
          plan("starter"),
        ]),
      ).toBe("pro");
    });

    it("falls back to starter when the catalog is empty", () => {
      expect(resolveInitialSelectedPlan([])).toBe("starter");
    });
  });

  describe("hasSelectablePaidPlan", () => {
    it("is false when every plan is current or the list is empty", () => {
      expect(hasSelectablePaidPlan([])).toBe(false);
      expect(hasSelectablePaidPlan([plan("standard", true)])).toBe(false);
    });

    it("is true when at least one non-current paid plan exists", () => {
      expect(hasSelectablePaidPlan([plan("standard", true), plan("pro")])).toBe(
        true,
      );
    });
  });
});
