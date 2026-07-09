import { describe, expect, it } from "vitest";

import { resolveSubscriptionOnboardingGateDecision } from "../subscription-onboarding-gate-decision";

describe("resolveSubscriptionOnboardingGateDecision", () => {
  it("loads the gate for free users without coverage", () => {
    expect(
      resolveSubscriptionOnboardingGateDecision({
        alreadyServed: false,
        hasPaidOrEnterpriseCoverage: false,
        shouldShowFreeSubscriptionGate: true,
      }),
    ).toBe("load");
  });

  it("marks the gate seen when coverage exists", () => {
    expect(
      resolveSubscriptionOnboardingGateDecision({
        alreadyServed: false,
        hasPaidOrEnterpriseCoverage: true,
        shouldShowFreeSubscriptionGate: true,
      }),
    ).toBe("mark-seen");
  });

  it("skips when the gate was already served this session", () => {
    expect(
      resolveSubscriptionOnboardingGateDecision({
        alreadyServed: true,
        hasPaidOrEnterpriseCoverage: false,
        shouldShowFreeSubscriptionGate: true,
      }),
    ).toBe("none");
  });

  it("skips when the free subscription gate should not show", () => {
    expect(
      resolveSubscriptionOnboardingGateDecision({
        alreadyServed: false,
        hasPaidOrEnterpriseCoverage: false,
        shouldShowFreeSubscriptionGate: false,
      }),
    ).toBe("none");
  });
});
