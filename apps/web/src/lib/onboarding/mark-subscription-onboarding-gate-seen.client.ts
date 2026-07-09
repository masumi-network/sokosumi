import { markSubscriptionOnboardingGateSessionSeen } from "@/lib/actions/onboarding";

export function markSubscriptionOnboardingGateSeenSafely(
  loginId: string,
): void {
  void markSubscriptionOnboardingGateSessionSeen(loginId).catch(
    (error: unknown) => {
      console.error(
        "Failed to mark subscription onboarding gate as seen",
        error,
      );
    },
  );
}
