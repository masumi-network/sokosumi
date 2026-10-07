import { describe, expect, it } from "vitest";

import {
  getPlanTranslationKey,
  resolveScheduledCancelDate,
} from "@/components/billing/subscription-plan-utils";

describe("subscription-plan-utils", () => {
  it("returns translation keys for subscription plans", () => {
    expect(getPlanTranslationKey("starter")).toBe("starter");
    expect(getPlanTranslationKey("pro")).toBe("pro");
    expect(getPlanTranslationKey("enterprise")).toBe("enterprise");
  });

  describe("resolveScheduledCancelDate", () => {
    const cancelAt = new Date("2026-05-01T00:00:00.000Z");
    const periodEnd = new Date("2026-04-01T00:00:00.000Z");

    it("uses cancelAt when flexible billing mode schedules the cancellation", () => {
      expect(
        resolveScheduledCancelDate({
          cancelAt,
          cancelAtPeriodEnd: false,
          periodEnd,
        }),
      ).toBe(cancelAt);
    });

    it("uses periodEnd when only cancelAtPeriodEnd is set", () => {
      expect(
        resolveScheduledCancelDate({
          cancelAt: null,
          cancelAtPeriodEnd: true,
          periodEnd,
        }),
      ).toBe(periodEnd);
    });

    it("returns null when no cancellation is scheduled", () => {
      expect(
        resolveScheduledCancelDate({
          cancelAt: null,
          cancelAtPeriodEnd: false,
          periodEnd,
        }),
      ).toBeNull();
      expect(resolveScheduledCancelDate(null)).toBeNull();
    });
  });
});
