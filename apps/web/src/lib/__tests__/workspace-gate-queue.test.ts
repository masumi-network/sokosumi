import { describe, expect, it } from "vitest";

import { shouldShowPendingInvitesQueue } from "../workspace-gate-queue";

describe("shouldShowPendingInvitesQueue", () => {
  it("shows the queue when Core gate is pending-invites", () => {
    expect(
      shouldShowPendingInvitesQueue({
        gate: "pending-invites",
        invitationCount: 0,
        hasJoinLink: false,
      }),
    ).toBe(true);
  });

  it("shows the queue when identity-onboarding still has a join link", () => {
    expect(
      shouldShowPendingInvitesQueue({
        gate: "identity-onboarding",
        invitationCount: 0,
        hasJoinLink: true,
      }),
    ).toBe(true);
  });

  it("shows the queue when invitations exist even if gate drifted", () => {
    expect(
      shouldShowPendingInvitesQueue({
        gate: "identity-onboarding",
        invitationCount: 2,
        hasJoinLink: false,
      }),
    ).toBe(true);
  });

  it("hides the queue for empty identity-onboarding", () => {
    expect(
      shouldShowPendingInvitesQueue({
        gate: "identity-onboarding",
        invitationCount: 0,
        hasJoinLink: false,
      }),
    ).toBe(false);
  });
});
