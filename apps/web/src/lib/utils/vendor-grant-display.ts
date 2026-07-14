import type { VendorGrant } from "@/lib/clients/generated/core";

export type VendorGrantEntry = {
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  grant: VendorGrant | null;
};

export function isGrantPending(entry: VendorGrantEntry): boolean {
  return entry.grant?.status === "PENDING";
}

export function isGrantGranted(entry: VendorGrantEntry): boolean {
  return entry.grant?.status === "GRANTED";
}

export function isGrantDeniedOrRevoked(entry: VendorGrantEntry): boolean {
  return entry.grant?.status === "DENIED" || entry.grant?.status === "REVOKED";
}

export function getPendingVendorIds(entries: VendorGrantEntry[]): string[] {
  return entries
    .filter((entry) => isGrantPending(entry))
    .map((entry) => entry.vendorId);
}

/**
 * One card per vendor. Vendors with PENDING grants sort first, then by name.
 */
export function groupVendorGrantsByVendor(
  grants: VendorGrant[],
): VendorGrantEntry[] {
  const byVendor = new Map<string, VendorGrant>();

  for (const grant of grants) {
    const existing = byVendor.get(grant.vendorId);
    if (!existing || preferGrantForDisplay(grant, existing) === grant) {
      byVendor.set(grant.vendorId, grant);
    }
  }

  const entries: VendorGrantEntry[] = [];

  for (const grant of byVendor.values()) {
    entries.push({
      vendorId: grant.vendorId,
      vendorName: grant.vendorName,
      vendorSlug: grant.vendorSlug,
      grant,
    });
  }

  return entries.toSorted((left, right) => {
    const leftPending = isGrantPending(left);
    const rightPending = isGrantPending(right);
    if (leftPending !== rightPending) {
      return leftPending ? -1 : 1;
    }
    return left.vendorName.localeCompare(right.vendorName);
  });
}

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
