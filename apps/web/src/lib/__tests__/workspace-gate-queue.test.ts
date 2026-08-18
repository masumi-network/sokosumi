import { describe, expect, it } from "vitest";

import {
  isJoinLinkDuplicateOfInvitation,
  resolveWorkspaceGateSurface,
  shouldShowPendingInvitesQueue,
} from "../workspace-gate-queue";

describe("isJoinLinkDuplicateOfInvitation", () => {
  it("is true when the join slug already has an invitation row", () => {
    expect(isJoinLinkDuplicateOfInvitation(["acme", "other"], "acme")).toBe(
      true,
    );
  });

  it("is false when the join slug is a different organization", () => {
    expect(isJoinLinkDuplicateOfInvitation(["acme"], "join-co")).toBe(false);
  });

  it("is false when there are no invitation rows", () => {
    expect(isJoinLinkDuplicateOfInvitation([], "acme")).toBe(false);
  });
});

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

describe("resolveWorkspaceGateSurface", () => {
  it("treats a failed invite list as unavailable, not an empty queue", () => {
    expect(
      resolveWorkspaceGateSurface({
        workspaceAccessLoadFailed: false,
        gate: "pending-invites",
        invitationCount: 0,
        invitationsLoadFailed: true,
        hasJoinLink: false,
      }),
    ).toBe("unavailable");
  });

  it("still shows the queue when a join link recovered after list failure", () => {
    expect(
      resolveWorkspaceGateSurface({
        workspaceAccessLoadFailed: false,
        gate: "pending-invites",
        invitationCount: 0,
        invitationsLoadFailed: true,
        hasJoinLink: true,
      }),
    ).toBe("pending-invites");
  });
});
