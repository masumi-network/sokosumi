import { describe, expect, it } from "vitest";

import type { VendorGrant } from "@/lib/clients/generated/core";
import { groupPendingVendorGrants } from "@/lib/utils/vendor-grant-display";

function buildGrant(
  overrides: Partial<VendorGrant> & Pick<VendorGrant, "id" | "permission">,
): VendorGrant {
  return {
    vendorId: "vendor-1",
    vendorName: "Acme",
    vendorSlug: "acme",
    workspaceId: "workspace-1",
    status: "PENDING",
    requestedByUserId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("groupPendingVendorGrants", () => {
  it("bundles pending task:read and task:comment for the same vendor", () => {
    const grants = [
      buildGrant({ id: "read-grant", permission: "task:read" }),
      buildGrant({ id: "comment-grant", permission: "task:comment" }),
    ];

    expect(groupPendingVendorGrants(grants)).toEqual([
      {
        kind: "bundled",
        vendorId: "vendor-1",
        vendorName: "Acme",
        vendorSlug: "acme",
        primaryGrantId: "read-grant",
        commentGrantId: "comment-grant",
      },
    ]);
  });

  it("keeps unrelated pending grants as single rows", () => {
    const grants = [
      buildGrant({ id: "create-grant", permission: "task:create" }),
    ];

    expect(groupPendingVendorGrants(grants)).toEqual([
      {
        kind: "single",
        grant: grants[0],
      },
    ]);
  });
});
