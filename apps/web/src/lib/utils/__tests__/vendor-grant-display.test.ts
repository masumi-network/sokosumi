import { describe, expect, it } from "vitest";

import type { VendorGrant } from "@/lib/clients/generated/core";
import {
  getActionablePendingGrants,
  getGrantPermissionsForPendingVendorGroup,
  groupVendorGrantsByVendor,
  isFullyGranted,
  orderGrantsForBundledActions,
  VENDOR_PERMISSION_ORDER,
} from "@/lib/utils/vendor-grant-display";

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

describe("groupVendorGrantsByVendor", () => {
  it("builds fixed permission slots per vendor", () => {
    const grants = [
      buildGrant({
        id: "read-grant",
        permission: "task:read",
        status: "GRANTED",
      }),
      buildGrant({
        id: "create-grant",
        permission: "task:create",
        status: "PENDING",
      }),
    ];

    const groups = groupVendorGrantsByVendor(grants);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.slots.map((slot) => slot.permission)).toEqual([
      "task:read",
      "task:comment",
      "task:create",
    ]);
    expect(groups[0]?.slots[0]?.grant?.id).toBe("read-grant");
    expect(groups[0]?.slots[1]?.grant).toBeNull();
    expect(groups[0]?.slots[2]?.grant?.id).toBe("create-grant");
    expect(groups[0]?.hasPending).toBe(true);
  });

  it("marks pending comment as bundled when read is also pending", () => {
    const grants = [
      buildGrant({ id: "read-grant", permission: "task:read" }),
      buildGrant({ id: "comment-grant", permission: "task:comment" }),
    ];

    const [group] = groupVendorGrantsByVendor(grants);

    expect(group?.slots[0]?.bundledWithPendingRead).toBe(false);
    expect(group?.slots[1]?.bundledWithPendingRead).toBe(true);
    expect(group?.slots[1]?.grant?.id).toBe("comment-grant");
  });

  it("orders pending grants read before create", () => {
    const grants = [
      buildGrant({
        id: "create-grant",
        permission: "task:create",
        status: "PENDING",
      }),
      buildGrant({
        id: "read-grant",
        permission: "task:read",
        status: "PENDING",
      }),
    ];

    const [group] = groupVendorGrantsByVendor(grants);
    const pending = getActionablePendingGrants(group!);

    expect(
      orderGrantsForBundledActions(pending).map((g) => g.permission),
    ).toEqual(["task:read", "task:create"]);
  });

  it("builds permissions[] for proactive grant including bundled comment", () => {
    const grants = [
      buildGrant({ id: "read-grant", permission: "task:read" }),
      buildGrant({ id: "comment-grant", permission: "task:comment" }),
    ];

    const [group] = groupVendorGrantsByVendor(grants);

    expect(getGrantPermissionsForPendingVendorGroup(group!)).toEqual([
      "task:read",
      "task:comment",
    ]);
    expect(getActionablePendingGrants(group!)).toHaveLength(1);
  });

  it("detects fully granted vendors", () => {
    const grants = VENDOR_PERMISSION_ORDER.map((permission, index) =>
      buildGrant({
        id: `grant-${index}`,
        permission,
        status: "GRANTED",
      }),
    );

    const [group] = groupVendorGrantsByVendor(grants);
    expect(isFullyGranted(group!)).toBe(true);
  });
  it("sorts vendors with pending grants first, then by name", () => {
    const grants = [
      buildGrant({
        id: "zeta-read",
        permission: "task:read",
        vendorId: "vendor-z",
        vendorName: "Zeta",
        vendorSlug: "zeta",
        status: "GRANTED",
      }),
      buildGrant({
        id: "acme-create",
        permission: "task:create",
        vendorId: "vendor-a",
        vendorName: "Acme",
        vendorSlug: "acme",
        status: "PENDING",
      }),
      buildGrant({
        id: "beta-read",
        permission: "task:read",
        vendorId: "vendor-b",
        vendorName: "Beta",
        vendorSlug: "beta",
        status: "GRANTED",
      }),
    ];

    expect(groupVendorGrantsByVendor(grants).map((g) => g.vendorName)).toEqual([
      "Acme",
      "Beta",
      "Zeta",
    ]);
  });
});
