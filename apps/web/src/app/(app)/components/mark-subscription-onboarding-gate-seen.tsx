"use client";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { markSubscriptionOnboardingGateSessionSeen } from "@/lib/actions/onboarding";

interface MarkSubscriptionOnboardingGateSeenProps {
  loginId: string;
}

/**
 * Marks the subscription-only onboarding gate as served for this auth session
 * when the server already decided the dialog must stay hidden (paid plan or
 * enterprise contract coverage). Keeps later navigations from re-running the
 * coverage checks.
 */
export function MarkSubscriptionOnboardingGateSeen({
  loginId,
}: MarkSubscriptionOnboardingGateSeenProps) {
  useMountEffect(() => {
    void markSubscriptionOnboardingGateSessionSeen(loginId);
  });

  return null;
}
