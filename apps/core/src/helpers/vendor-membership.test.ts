import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  assertCanRemoveOrDemoteVendorAdmin,
  buildAccessibleCoworkerMembershipOr,
  buildAccessibleCoworkersWhere,
  requireAssignableVendorMembership,
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
  requireVendorAdminOrPlatformAdmin,
  resolveUserIdFromIdentity,
  resolveUserIdFromUserIdOrEmail,
} from "./vendor-membership";

const {
  vendorFindUniqueMock,
  vendorMemberFindFirstMock,
  vendorMemberCountMock,
  coworkerFindFirstMock,
  userFindUniqueMock,
  userFindFirstMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  vendorMemberCountMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendor: {
      findUnique: vendorFindUniqueMock,
    },
    vendorMember: {
      findFirst: vendorMemberFindFirstMock,
      count: vendorMemberCountMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    user: {
      findUnique: userFindUniqueMock,
      findFirst: userFindFirstMock,
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

describe("requireVendorAdminOrPlatformAdmin", () => {
  const userAuth: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  };

  const platformAdminAuth: AuthenticationContext = {
    actor: "user",
    userId: "admin_123",
    organizationId: null,
    role: "admin",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vendorFindUniqueMock.mockResolvedValue({ id: TEST_VENDOR_ID });
  });

  it("allows platform admin without vendor membership", async () => {
    await expect(
      requireVendorAdminOrPlatformAdmin(platformAdminAuth, TEST_VENDOR_ID),
    ).resolves.toMatchObject({ userId: "admin_123" });
    expect(vendorMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows vendor admin membership", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ id: "vm_1" });

    await expect(
      requireVendorAdminOrPlatformAdmin(userAuth, TEST_VENDOR_ID),
    ).resolves.toMatchObject({ userId: "user_123" });
  });

  it("throws 404 when vendor is missing for platform admin", async () => {
    vendorFindUniqueMock.mockResolvedValue(null);

    await expect(
      requireVendorAdminOrPlatformAdmin(platformAdminAuth, TEST_VENDOR_ID),
    ).rejects.toMatchObject({
      status: 404,
      message: "Vendor not found",
    });
  });

  it("throws 403 when user is neither platform nor vendor admin", async () => {
    vendorMemberFindFirstMock.mockResolvedValue(null);

    await expect(
      requireVendorAdminOrPlatformAdmin(userAuth, TEST_VENDOR_ID),
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

describe("resolveUserIdFromIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves by userId", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });

    await expect(
      resolveUserIdFromIdentity({ userId: "user_123" }),
    ).resolves.toBe("user_123");
  });

  it("resolves by email case-insensitively", async () => {
    userFindFirstMock.mockResolvedValue({ id: "user_123" });

    await expect(
      resolveUserIdFromIdentity({ email: "Dev@Example.com" }),
    ).resolves.toBe("user_123");
    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: {
        email: { equals: "Dev@Example.com", mode: "insensitive" },
      },
      select: { id: true },
    });
  });

  it("throws when both identifiers are provided", async () => {
    await expect(
      resolveUserIdFromIdentity({
        userId: "user_123",
        email: "dev@example.com",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Provide exactly one of userId or email",
    });
  });
});

describe("resolveUserIdFromUserIdOrEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats values with @ as email", async () => {
    userFindFirstMock.mockResolvedValue({ id: "user_123" });

    await expect(
      resolveUserIdFromUserIdOrEmail("dev%40example.com"),
    ).resolves.toBe("user_123");
  });
});

describe("assertCanRemoveOrDemoteVendorAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows demoting a non-last admin", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ role: "admin" });
    vendorMemberCountMock.mockResolvedValue(2);

    await expect(
      assertCanRemoveOrDemoteVendorAdmin(TEST_VENDOR_ID, "user_123"),
    ).resolves.toBeUndefined();
  });

  it("blocks demoting the last admin", async () => {
    vendorMemberFindFirstMock.mockResolvedValue({ role: "admin" });
    vendorMemberCountMock.mockResolvedValue(1);

    await expect(
      assertCanRemoveOrDemoteVendorAdmin(TEST_VENDOR_ID, "user_123"),
    ).rejects.toMatchObject({
      status: 400,
      message: "Cannot remove or demote the last vendor admin",
    });
  });
});
