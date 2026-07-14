import type { VendorGrant } from "@/lib/clients/generated/core";

export type VendorGrantPermission = VendorGrant["permission"];

export const VENDOR_PERMISSION_ORDER = [
  "task:read",
  "task:comment",
  "task:create",
] as const satisfies readonly VendorGrantPermission[];

export type VendorPermissionSlot = {
  permission: VendorGrantPermission;
  grant: VendorGrant | null;
  /**
   * Pending comment is part of a pending read+comment ask. Approve/deny
   * should target the read grant (API bundles comment).
   */
  bundledWithPendingRead: boolean;
};

export type VendorGrantGroup = {
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  slots: VendorPermissionSlot[];
  hasPending: boolean;
};

/**
 * Groups all grants into one card per vendor with fixed permission slots.
 * Vendors with any PENDING grant sort first, then by vendor name.
 */
export function groupVendorGrantsByVendor(
  grants: VendorGrant[],
): VendorGrantGroup[] {
  const byVendor = new Map<string, VendorGrant[]>();

  for (const grant of grants) {
    const existing = byVendor.get(grant.vendorId) ?? [];
    existing.push(grant);
    byVendor.set(grant.vendorId, existing);
  }

  const groups: VendorGrantGroup[] = [];

  for (const vendorGrants of byVendor.values()) {
    const first = vendorGrants[0];
    if (!first) {
      continue;
    }

    const byPermission = new Map<VendorGrantPermission, VendorGrant>();
    for (const grant of vendorGrants) {
      const existing = byPermission.get(grant.permission);
      if (!existing || preferGrantForDisplay(grant, existing) === grant) {
        byPermission.set(grant.permission, grant);
      }
    }

    const readGrant = byPermission.get("task:read") ?? null;
    const commentGrant = byPermission.get("task:comment") ?? null;
    const bundledWithPendingRead =
      readGrant?.status === "PENDING" && commentGrant?.status === "PENDING";

    const slots: VendorPermissionSlot[] = VENDOR_PERMISSION_ORDER.map(
      (permission) => ({
        permission,
        grant: byPermission.get(permission) ?? null,
        bundledWithPendingRead:
          permission === "task:comment" && bundledWithPendingRead,
      }),
    );

    groups.push({
      vendorId: first.vendorId,
      vendorName: first.vendorName,
      vendorSlug: first.vendorSlug,
      slots,
      hasPending: slots.some((slot) => slot.grant?.status === "PENDING"),
    });
  }

  return groups.toSorted((left, right) => {
    if (left.hasPending !== right.hasPending) {
      return left.hasPending ? -1 : 1;
    }
    return left.vendorName.localeCompare(right.vendorName);
  });
}

/**
 * Prefer actionable grant rows when the unique constraint somehow yields
 * duplicates in client-side aggregates (should be rare). PENDING > GRANTED >
 * other.
 */
function preferGrantForDisplay(
  candidate: VendorGrant,
  current: VendorGrant,
): VendorGrant {
  const rank = (status: VendorGrant["status"]) => {
    switch (status) {
      case "PENDING":
        return 0;
      case "GRANTED":
        return 1;
      case "DENIED":
        return 2;
      case "REVOKED":
        return 3;
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  return rank(candidate.status) < rank(current.status) ? candidate : current;
}
