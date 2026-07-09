export type SubscriptionOnboardingGateDecision = "load" | "mark-seen" | "none";

interface ResolveSubscriptionOnboardingGateDecisionInput {
  alreadyServed: boolean;
  hasPaidOrEnterpriseCoverage: boolean;
  shouldShowFreeSubscriptionGate: boolean;
}

/**
 * Decides how the app layout should handle the subscription-only onboarding
 * gate after credits look free.
 *
 * - `load`: mount the subscription-only onboarding dialog
 * - `mark-seen`: coverage exists — set the session cookie without showing UI
 * - `none`: skip (full onboarding, non-free plan, or gate already served)
 *
 * Cookie is session-scoped: if coverage is lost mid-session the hint stays
 * suppressed until the next login. That matches existing gate semantics.
 */
export function resolveSubscriptionOnboardingGateDecision({
  alreadyServed,
  hasPaidOrEnterpriseCoverage,
  shouldShowFreeSubscriptionGate,
}: ResolveSubscriptionOnboardingGateDecisionInput): SubscriptionOnboardingGateDecision {
  if (!shouldShowFreeSubscriptionGate || alreadyServed) {
    return "none";
  }

  if (hasPaidOrEnterpriseCoverage) {
    return "mark-seen";
  }

  return "load";
}
