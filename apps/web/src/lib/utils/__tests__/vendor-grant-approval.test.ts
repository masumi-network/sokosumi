import { describe, expect, it } from "vitest";

import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import {
  buildVendorGrantReviewHref,
  canApproveVendorGrants,
  resolveViewerOrganizationMembership,
} from "@/lib/utils/vendor-grant-approval";

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

describe("vendor-grant-approval utils", () => {
  it("resolves membership by organization id", () => {
    const members = [member("org_1", "member", "acme")];

    expect(resolveViewerOrganizationMembership("org_1", members)?.role).toBe(
      "member",
    );
    expect(resolveViewerOrganizationMembership(null, members)).toBeUndefined();
  });

  it("allows personal workspace owners and org owner/admin to approve", () => {
    expect(
      canApproveVendorGrants({
        organizationId: null,
        isAuthenticated: true,
      }),
    ).toBe(true);

    expect(
      canApproveVendorGrants({
        organizationId: null,
        isAuthenticated: true,
        taskOwnerUserId: "user_owner",
        sessionUserId: "user_owner",
      }),
    ).toBe(true);

    expect(
      canApproveVendorGrants({
        organizationId: null,
        isAuthenticated: true,
        taskOwnerUserId: "user_owner",
        sessionUserId: "user_other",
      }),
    ).toBe(false);

    expect(
      canApproveVendorGrants({
        organizationId: "org_1",
        isAuthenticated: true,
        viewerMembership: member("org_1", "owner", "acme"),
      }),
    ).toBe(true);

    expect(
      canApproveVendorGrants({
        organizationId: "org_1",
        isAuthenticated: true,
        viewerMembership: member("org_1", "member", "acme"),
      }),
    ).toBe(false);
  });

  it("builds review links for personal and organization workspaces", () => {
    expect(
      buildVendorGrantReviewHref({
        organizationId: null,
      }),
    ).toBe("/account#vendor-workspace-access");

    expect(
      buildVendorGrantReviewHref({
        organizationId: "org_1",
        organizationSlug: "acme-labs",
      }),
    ).toBe("/organizations/acme-labs#vendor-workspace-access");

    expect(
      buildVendorGrantReviewHref({
        organizationId: "org_1",
        organizationSlug: null,
      }),
    ).toBe("/organizations/org_1#vendor-workspace-access");
  });
});
