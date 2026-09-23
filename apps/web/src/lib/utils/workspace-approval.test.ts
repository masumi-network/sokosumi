import { describe, expect, it } from "vitest";

import type {
  MemberWithOrganization,
  VendorGrant,
} from "@/lib/clients/generated/core";
import {
  buildWorkspaceApprovalReviewHref,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  COWORKER_ACCESS_REVIEW_HASH,
  canApproveWorkspaceAccess,
  getPendingVendorIds,
  groupVendorGrantsByVendor,
  isPendingWorkspaceApprovalNotification,
  isWorkspaceApprovalDeniedOrRevoked,
  isWorkspaceApprovalGranted,
  isWorkspaceApprovalPending,
  resolveViewerOrganizationMembership,
  resolveWorkspaceApprovalNotificationTarget,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_REVIEW_HASH,
  workspaceApprovalStatusMessageKey,
} from "@/lib/utils/workspace-approval";

function buildGrant(
  overrides: Partial<VendorGrant> & Pick<VendorGrant, "vendorId">,
): VendorGrant {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    vendorName: "Acme",
    vendorSlug: "acme",
    workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    permission: "workspace",
    status: "PENDING",
    requestedByUserId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function member(
  organizationId: string,
  role: MemberWithOrganization["role"],
  slug: string,
): MemberWithOrganization {
  return {
    id: "mem_1",
    userId: "user_1",
    organizationId,
    role,
    seatAssignedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    organization: {
      id: organizationId,
      name: "Acme",
      slug,
      logo: null,
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      stripeCustomerId: null,
    },
  };
}

describe("isPendingWorkspaceApprovalNotification", () => {
  it("detects the matching pending message key", () => {
    expect(
      isPendingWorkspaceApprovalNotification(
        { messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toBe(true);
    expect(
      isPendingWorkspaceApprovalNotification(
        { messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY },
        COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      ),
    ).toBe(true);
  });

  it("rejects other message keys", () => {
    expect(
      isPendingWorkspaceApprovalNotification(
        { messageKey: "notifications.job.completed" },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toBe(false);
    expect(
      isPendingWorkspaceApprovalNotification(
        { messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY },
        COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      ),
    ).toBe(false);
  });
});

describe("resolveWorkspaceApprovalNotificationTarget", () => {
  it("returns requestId from referenceId and organization fields from metadata", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
          referenceId: "grant-1",
          metadata: { organizationId: "org-1", vendorId: "v-1" },
        },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "grant-1",
      organizationId: "org-1",
      organizationSlug: null,
    });

    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
          referenceId: "access-1",
          metadata: {
            organizationId: "org-1",
            organizationSlug: "acme",
            coworkerId: "c-1",
          },
        },
        COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "access-1",
      organizationId: "org-1",
      organizationSlug: "acme",
    });
  });

  it("returns null organization fields for personal workspace requests", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
          referenceId: "grant-2",
          metadata: { organizationId: null, workspaceId: "ws-1" },
        },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "grant-2",
      organizationId: null,
      organizationSlug: null,
    });
  });

  it("returns null organization fields when metadata lacks them", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
          referenceId: "access-3",
          metadata: null,
        },
        COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "access-3",
      organizationId: null,
      organizationSlug: null,
    });
  });

  it("returns null organization fields when values are not strings", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
          referenceId: "grant-4",
          metadata: { organizationId: 42, organizationSlug: 99 },
        },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "grant-4",
      organizationId: null,
      organizationSlug: null,
    });
  });

  it("treats blank organizationSlug as null", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
          referenceId: "access-4b",
          metadata: { organizationId: "org-1", organizationSlug: "  " },
        },
        COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      ),
    ).toEqual({
      requestId: "access-4b",
      organizationId: "org-1",
      organizationSlug: null,
    });
  });

  it("returns null for non-matching notifications", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: "notifications.job.completed",
          referenceId: "grant-5",
          metadata: { organizationId: "org-1" },
        },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toBeNull();
  });

  it("returns null when referenceId is empty", () => {
    expect(
      resolveWorkspaceApprovalNotificationTarget(
        {
          messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
          referenceId: "",
          metadata: { organizationId: "org-1" },
        },
        VENDOR_GRANT_PENDING_MESSAGE_KEY,
      ),
    ).toBeNull();
  });
});

describe("buildWorkspaceApprovalReviewHref", () => {
  it("links personal workspace to the account anchor", () => {
    expect(
      buildWorkspaceApprovalReviewHref({
        organizationId: null,
        hash: VENDOR_GRANT_REVIEW_HASH,
      }),
    ).toBe("/account#vendor-workspace-access");
    expect(
      buildWorkspaceApprovalReviewHref({
        organizationId: null,
        hash: COWORKER_ACCESS_REVIEW_HASH,
      }),
    ).toBe("/account#coworker-early-access");
  });

  it("prefers organization slug when present", () => {
    expect(
      buildWorkspaceApprovalReviewHref({
        organizationId: "org-1",
        organizationSlug: "acme",
        hash: COWORKER_ACCESS_REVIEW_HASH,
      }),
    ).toBe("/organizations/acme#coworker-early-access");
  });

  it("falls back to organization id", () => {
    expect(
      buildWorkspaceApprovalReviewHref({
        organizationId: "org_1",
        organizationSlug: null,
        hash: VENDOR_GRANT_REVIEW_HASH,
      }),
    ).toBe("/organizations/org_1#vendor-workspace-access");
  });
});

describe("workspace-approval membership and can-approve", () => {
  it("resolves membership by organization id", () => {
    const members = [member("org_1", "member", "acme")];

    expect(resolveViewerOrganizationMembership("org_1", members)?.role).toBe(
      "member",
    );
    expect(resolveViewerOrganizationMembership(null, members)).toBeUndefined();
  });

  it("allows personal workspace owners and org owner/admin to approve", () => {
    expect(
      canApproveWorkspaceAccess({
        organizationId: null,
        isAuthenticated: true,
      }),
    ).toBe(true);

    expect(
      canApproveWorkspaceAccess({
        organizationId: null,
        isAuthenticated: true,
        taskOwnerId: "user_owner",
        sessionUserId: "user_owner",
      }),
    ).toBe(true);

    expect(
      canApproveWorkspaceAccess({
        organizationId: null,
        isAuthenticated: true,
        taskOwnerId: "user_owner",
        sessionUserId: "user_other",
      }),
    ).toBe(false);

    expect(
      canApproveWorkspaceAccess({
        organizationId: "org_1",
        isAuthenticated: true,
        viewerMembership: member("org_1", "owner", "acme"),
      }),
    ).toBe(true);

    expect(
      canApproveWorkspaceAccess({
        organizationId: "org_1",
        isAuthenticated: true,
        viewerMembership: member("org_1", "member", "acme"),
      }),
    ).toBe(false);
  });
});

describe("workspace-approval status helpers", () => {
  it("detects pending, granted, and terminal statuses", () => {
    expect(isWorkspaceApprovalPending("PENDING")).toBe(true);
    expect(isWorkspaceApprovalGranted("GRANTED")).toBe(true);
    expect(isWorkspaceApprovalDeniedOrRevoked("DENIED")).toBe(true);
    expect(isWorkspaceApprovalDeniedOrRevoked("REVOKED")).toBe(true);
    expect(isWorkspaceApprovalPending("GRANTED")).toBe(false);
    expect(isWorkspaceApprovalGranted("PENDING")).toBe(false);
  });

  it("maps status to message keys", () => {
    expect(workspaceApprovalStatusMessageKey("PENDING")).toBe("statusPending");
    expect(workspaceApprovalStatusMessageKey("GRANTED")).toBe("statusGranted");
    expect(workspaceApprovalStatusMessageKey("DENIED")).toBe("statusDenied");
    expect(workspaceApprovalStatusMessageKey("REVOKED")).toBe("statusRevoked");
  });
});

describe("groupVendorGrantsByVendor", () => {
  it("groups one entry per vendor with pending first", () => {
    const grants = [
      buildGrant({
        vendorId: "11111111-1111-4111-8111-111111111111",
        vendorName: "Zeta",
        status: "GRANTED",
      }),
      buildGrant({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        vendorId: "22222222-2222-4222-8222-222222222222",
        vendorName: "Alpha",
        status: "PENDING",
      }),
    ];

    const entries = groupVendorGrantsByVendor(grants);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.vendorName).toBe("Alpha");
    expect(isWorkspaceApprovalPending(entries[0]?.grant?.status)).toBe(true);
    expect(isWorkspaceApprovalGranted(entries[1]?.grant?.status)).toBe(true);
  });

  it("returns pending vendor ids", () => {
    const grants = [
      buildGrant({
        vendorId: "22222222-2222-4222-8222-222222222222",
        status: "PENDING",
      }),
    ];

    const entries = groupVendorGrantsByVendor(grants);

    expect(getPendingVendorIds(entries)).toEqual([
      "22222222-2222-4222-8222-222222222222",
    ]);
  });
});
