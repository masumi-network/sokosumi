import { describe, expect, it } from "vitest";

import type { VendorGrant } from "@/lib/clients/generated/core";
import {
  getPendingVendorIds,
  groupVendorGrantsByVendor,
  isGrantGranted,
  isGrantPending,
} from "@/lib/utils/vendor-grant-display";

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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
    expect(isGrantPending(entries[0]!)).toBe(true);
    expect(isGrantGranted(entries[1]!)).toBe(true);
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
