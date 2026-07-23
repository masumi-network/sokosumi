import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  buildAccessibleCoworkerMembershipOr,
  buildAccessibleCoworkersWhere,
  requireAssignableVendorMembership,
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
} from "./vendor-membership";

const {
  vendorFindUniqueMock,
  vendorMemberFindFirstMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      findUnique: vendorFindUniqueMock,
    },
    vendorMember: {
      findFirst: vendorMemberFindFirstMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

describe("buildAccessibleCoworkersWhere", () => {
  it("includes vendor admin and assignment membership paths", () => {
    expect(buildAccessibleCoworkersWhere("user_123")).toEqual({
      OR: buildAccessibleCoworkerMembershipOr("user_123"),
    });
    expect(buildAccessibleCoworkerMembershipOr("user_123")).toEqual([
      {
        vendor: {
          vendorMembers: {
            some: {
              userId: "user_123",
              role: "admin",
            },
          },
        },
      },
      {
        assignments: {
          some: {
            userId: "user_123",
          },
        },
      },
    ]);
  });
});

describe("requireVendorAdminMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindUniqueMock.mockResolvedValue({ id: TEST_VENDOR_ID });
  });

  it("resolves when the user is a vendor admin", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_1" });

    await expect(
      requireVendorAdminMembership("user_123", TEST_VENDOR_ID),
    ).resolves.toBeUndefined();
  });

  it("throws 404 when the vendor does not exist", async () => {
    vendorFindUniqueMock.mockResolvedValue(null);

    await expect(
      requireVendorAdminMembership("user_123", TEST_VENDOR_ID),
    ).rejects.toMatchObject({
      status: 404,
      message: "Vendor not found",
    });
  });

  it("throws 403 when the user is not a vendor admin", async () => {
    vendorMemberFindFirstMock.mockResolvedValue(null);

    await expect(
      requireVendorAdminMembership("user_123", TEST_VENDOR_ID),
    ).rejects.toMatchObject({
      status: 403,
      message: "Vendor admin access required",
    });
  });
});

describe("requireAssignableVendorMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the user is a developer member", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_dev" });

    await expect(
      requireAssignableVendorMembership("dev_123", TEST_VENDOR_ID),
    ).resolves.toBeUndefined();
  });

  it("resolves when the user is a vendor admin member", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_admin" });

    await expect(
      requireAssignableVendorMembership("admin_123", TEST_VENDOR_ID),
    ).resolves.toBeUndefined();
  });

  it("throws 400 when the user is not a vendor member", async () => {
    vendorMemberFindFirstMock.mockResolvedValue(null);

    await expect(
      requireAssignableVendorMembership("outsider", TEST_VENDOR_ID),
    ).rejects.toMatchObject({
      status: 400,
      message: "Target user must be a member of this vendor",
    });
  });
});

describe("requireCoworkerBelongsToVendor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the coworker belongs to the vendor", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_123" });

    await expect(
      requireCoworkerBelongsToVendor("cow_123", TEST_VENDOR_ID),
    ).resolves.toBeUndefined();
  });

  it("throws 404 when the coworker is missing or cross-vendor", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    await expect(
      requireCoworkerBelongsToVendor("cow_missing", TEST_VENDOR_ID),
    ).rejects.toMatchObject({
      status: 404,
      message: "Coworker not found",
    });
  });
});
