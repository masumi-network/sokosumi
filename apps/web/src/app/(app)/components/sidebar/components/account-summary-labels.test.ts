import { describe, expect, it } from "vitest";

import {
  isLowCreditsBalance,
  resolveAccountCreditsLabel,
  resolveAccountSummaryLabel,
  resolveCreditRenewalKind,
} from "@/app/components/sidebar/components/account-summary-labels";

describe("resolveAccountCreditsLabel", () => {
  it("returns null when total credits are unknown", () => {
    expect(
      resolveAccountCreditsLabel(null, (credits) => `balance ${credits}`),
    ).toBeNull();
  });

  it("formats the display total through the balance label", () => {
    expect(
      resolveAccountCreditsLabel(15_750, (credits) => `balance ${credits}`),
    ).toBe("balance 15750");
  });
});

describe("resolveAccountSummaryLabel", () => {
  it("combines plan and credits when both exist", () => {
    expect(
      resolveAccountSummaryLabel({
        planName: "Pro",
        creditsLabel: "balance 10",
        planAndCredits: (plan, credits) => `${plan} · ${credits}`,
        detailsUnavailable: "n/a",
      }),
    ).toBe("Pro · balance 10");
  });

  it("falls back to whichever of plan or credits is present", () => {
    expect(
      resolveAccountSummaryLabel({
        planName: null,
        creditsLabel: "balance 10",
        planAndCredits: (plan, credits) => `${plan} · ${credits}`,
        detailsUnavailable: "n/a",
      }),
    ).toBe("balance 10");

    expect(
      resolveAccountSummaryLabel({
        planName: "Pro",
        creditsLabel: null,
        planAndCredits: (plan, credits) => `${plan} · ${credits}`,
        detailsUnavailable: "n/a",
      }),
    ).toBe("Pro");
  });

  it("uses the unavailable label when neither plan nor credits exist", () => {
    expect(
      resolveAccountSummaryLabel({
        planName: null,
        creditsLabel: null,
        planAndCredits: (plan, credits) => `${plan} · ${credits}`,
        detailsUnavailable: "n/a",
      }),
    ).toBe("n/a");
  });
});

describe("isLowCreditsBalance", () => {
  it("is false when total is null, zero, or at/above the threshold", () => {
    expect(isLowCreditsBalance(null, 100)).toBe(false);
    expect(isLowCreditsBalance(0, 100)).toBe(false);
    expect(isLowCreditsBalance(100, 100)).toBe(false);
  });

  it("is true when a positive balance sits under the threshold", () => {
    expect(isLowCreditsBalance(42, 100)).toBe(true);
  });
});

describe("resolveCreditRenewalKind", () => {
  const now = 1_700_000_000_000;

  it("returns null without a period end or response timestamp", () => {
    expect(resolveCreditRenewalKind(null, now)).toBeNull();
    expect(resolveCreditRenewalKind(now + 86_400_000, 0)).toBeNull();
  });

  it("classifies expired, today, and remaining-day resets", () => {
    expect(resolveCreditRenewalKind(now - 1, now)).toEqual({ kind: "expired" });
    expect(resolveCreditRenewalKind(now + 3_600_000, now)).toEqual({
      kind: "today",
    });
    expect(resolveCreditRenewalKind(now + 3 * 86_400_000, now)).toEqual({
      kind: "inDays",
      days: 3,
    });
  });
});
