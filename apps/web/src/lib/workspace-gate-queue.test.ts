import { describe, expect, it } from "vitest";

import {
  isJoinLinkDuplicateOfInvitation,
  itemsForBatchAccept,
  pendingInvitesDescriptionKey,
  queueItemKey,
  resolveWorkspaceGateSurface,
  shouldShowPendingInvitesBatchActions,
  shouldShowPendingInvitesQueue,
} from "./workspace-gate-queue";

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

describe("pendingInvitesDescriptionKey", () => {
  it("names only invitations when the queue has no join row", () => {
    expect(
      pendingInvitesDescriptionKey({
        invitationCount: 1,
        hasJoinLink: false,
      }),
    ).toBe("pendingInvitesDescriptionInvitations");
  });

  it("names only the join link when that is the only row", () => {
    expect(
      pendingInvitesDescriptionKey({
        invitationCount: 0,
        hasJoinLink: true,
      }),
    ).toBe("pendingInvitesDescriptionJoin");
  });

  it("names both actions when invitation and join rows are present", () => {
    expect(
      pendingInvitesDescriptionKey({
        invitationCount: 1,
        hasJoinLink: true,
      }),
    ).toBe("pendingInvitesDescriptionBoth");
  });
});

const invitationA = {
  kind: "invitation" as const,
  id: "inv_1",
  organizationId: "org_1",
  organizationName: "Acme",
  organizationSlug: "acme",
};
const invitationB = {
  kind: "invitation" as const,
  id: "inv_2",
  organizationId: "org_2",
  organizationName: "Beta",
  organizationSlug: "beta",
};
const joinLink = {
  kind: "join" as const,
  token: "join_token_1",
  organizationName: "Join Co",
  organizationSlug: "join-co",
};

describe("queueItemKey", () => {
  it("uses invitation id and join token", () => {
    expect(queueItemKey(invitationA)).toBe("inv_1");
    expect(queueItemKey(joinLink)).toBe("join_token_1");
  });
});

describe("shouldShowPendingInvitesBatchActions", () => {
  it("hides Accept all on a one-item list", () => {
    expect(shouldShowPendingInvitesBatchActions(1)).toBe(false);
    expect(shouldShowPendingInvitesBatchActions(0)).toBe(false);
  });

  it("shows Accept all when more than one invite is pending", () => {
    expect(shouldShowPendingInvitesBatchActions(2)).toBe(true);
  });
});

describe("itemsForBatchAccept", () => {
  const items = [invitationA, invitationB, joinLink];

  it("returns every item for accept-all, including the join link", () => {
    expect(itemsForBatchAccept(items, "all", new Set())).toEqual(items);
  });

  it("returns only selected items in queue order", () => {
    expect(
      itemsForBatchAccept(
        items,
        "selected",
        new Set(["inv_2", "join_token_1"]),
      ),
    ).toEqual([invitationB, joinLink]);
  });

  it("returns an empty list when nothing is selected", () => {
    expect(itemsForBatchAccept(items, "selected", new Set())).toEqual([]);
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
