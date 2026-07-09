import { describe, expect, it, vi } from "vitest";

const markSubscriptionOnboardingGateSessionSeenMock = vi.fn();

vi.mock("@/lib/actions/onboarding", () => ({
  markSubscriptionOnboardingGateSessionSeen: (...args: unknown[]) =>
    markSubscriptionOnboardingGateSessionSeenMock(...args),
}));

describe("markSubscriptionOnboardingGateSeenSafely", () => {
  it("logs when the server action rejects", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    markSubscriptionOnboardingGateSessionSeenMock.mockRejectedValue(
      new Error("cookie write failed"),
    );

    const { markSubscriptionOnboardingGateSeenSafely } = await import(
      "../mark-subscription-onboarding-gate-seen.client"
    );

    markSubscriptionOnboardingGateSeenSafely("session-1");
    await Promise.resolve();

    expect(markSubscriptionOnboardingGateSessionSeenMock).toHaveBeenCalledWith(
      "session-1",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to mark subscription onboarding gate as seen",
      expect.any(Error),
    );
  });
});
