import type { VendorGrant } from "@/lib/clients/generated/core";

export type VendorGrantPermission = VendorGrant["permission"];

export type VendorGrantDisplayRow =
  | {
      kind: "bundled";
      vendorId: string;
      vendorName: string;
      vendorSlug: string;
      primaryGrantId: string;
      commentGrantId: string | null;
    }
  | {
      kind: "single";
      grant: VendorGrant;
    };

function isPendingReadCommentBundle(
  readGrant: VendorGrant,
  commentGrant: VendorGrant | undefined,
): boolean {
  return (
    readGrant.status === "PENDING" &&
    readGrant.permission === "task:read" &&
    commentGrant?.status === "PENDING" &&
    commentGrant.permission === "task:comment" &&
    commentGrant.vendorId === readGrant.vendorId
  );
}

/**
 * Groups pending grants so bundled task:read + task:comment rows for the same
 * vendor render as a single inbox item.
 */
export function groupPendingVendorGrants(
  grants: VendorGrant[],
): VendorGrantDisplayRow[] {
  const pending = grants.filter((grant) => grant.status === "PENDING");
  const byVendor = new Map<string, VendorGrant[]>();

  for (const grant of pending) {
    const existing = byVendor.get(grant.vendorId) ?? [];
    existing.push(grant);
    byVendor.set(grant.vendorId, existing);
  }

  const rows: VendorGrantDisplayRow[] = [];
  const consumedGrantIds = new Set<string>();

  for (const vendorGrants of byVendor.values()) {
    const readGrant = vendorGrants.find(
      (grant) => grant.permission === "task:read",
    );
    const commentGrant = vendorGrants.find(
      (grant) => grant.permission === "task:comment",
    );

    if (readGrant && isPendingReadCommentBundle(readGrant, commentGrant)) {
      rows.push({
        kind: "bundled",
        vendorId: readGrant.vendorId,
        vendorName: readGrant.vendorName,
        vendorSlug: readGrant.vendorSlug,
        primaryGrantId: readGrant.id,
        commentGrantId: commentGrant?.id ?? null,
      });
      consumedGrantIds.add(readGrant.id);
      if (commentGrant) {
        consumedGrantIds.add(commentGrant.id);
      }
      continue;
    }

    for (const grant of vendorGrants) {
      if (consumedGrantIds.has(grant.id)) {
        continue;
      }
      rows.push({ kind: "single", grant });
    }
  }

  return rows;
}
