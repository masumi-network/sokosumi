"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    void markSubscriptionOnboardingGateSessionSeen(loginId);
  }, [loginId]);

  return null;
}
