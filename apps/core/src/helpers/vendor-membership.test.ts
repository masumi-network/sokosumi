import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  assertCanChangeVendorMembership,
  buildAccessibleCoworkerMembershipOr,
  buildAccessibleCoworkersWhere,
  requireAssignableVendorMembership,
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
  requireVendorAdminOrPlatformAdmin,
} from "./vendor-membership";

const {
  vendorFindUniqueMock,
  vendorMemberFindFirstMock,
  vendorMemberCountMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  vendorFindUniqueMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  vendorMemberCountMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
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

  it("uses the provided transaction client for membership queries", async () => {
    const txVendorFindUnique = vi
      .fn()
      .mockResolvedValue({ id: TEST_VENDOR_ID });
    const txVendorMemberFindFirst = vi.fn().mockResolvedValue({ id: "vm_tx" });
    const tx = {
      vendor: { findUnique: txVendorFindUnique },
      vendorMember: { findFirst: txVendorMemberFindFirst },
    };

    await expect(
      requireVendorAdminMembership("user_123", TEST_VENDOR_ID, tx as never),
    ).resolves.toBeUndefined();

    expect(txVendorFindUnique).toHaveBeenCalledWith({
      where: { id: TEST_VENDOR_ID },
      select: { id: true },
    });
    expect(txVendorMemberFindFirst).toHaveBeenCalledWith({
      where: {
        vendorId: TEST_VENDOR_ID,
        userId: "user_123",
        role: "admin",
      },
      select: { id: true },
    });
    expect(vendorFindUniqueMock).not.toHaveBeenCalled();
    expect(vendorMemberFindFirstMock).not.toHaveBeenCalled();
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

describe("assertCanChangeVendorMembership", () => {
  const txQueryRaw = vi.fn();
  const txVendorMemberFindFirst = vi.fn();
  const txVendorMemberCount = vi.fn();
  const tx = {
    $queryRaw: txQueryRaw,
    vendorMember: {
      findFirst: txVendorMemberFindFirst,
      count: txVendorMemberCount,
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    txQueryRaw.mockResolvedValue([]);
  });

  it("allows demoting a non-last admin", async () => {
    txVendorMemberFindFirst.mockResolvedValue({ role: "admin" });
    txVendorMemberCount.mockResolvedValue(2);

    await expect(
      assertCanChangeVendorMembership(
        TEST_VENDOR_ID,
        "user_123",
        "developer",
        tx,
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks demoting the last admin", async () => {
    txVendorMemberFindFirst.mockResolvedValue({ role: "admin" });
    txVendorMemberCount.mockResolvedValue(1);

    await expect(
      assertCanChangeVendorMembership(
        TEST_VENDOR_ID,
        "user_123",
        "developer",
        tx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Cannot remove or demote the last vendor admin",
    });
  });

  it("throws 404 when the target is not a member", async () => {
    txVendorMemberFindFirst.mockResolvedValue(null);

    await expect(
      assertCanChangeVendorMembership(TEST_VENDOR_ID, "user_123", null, tx),
    ).rejects.toMatchObject({ status: 404 });
    expect(txVendorMemberCount).not.toHaveBeenCalled();
  });

  it("reads only through the provided transaction client", async () => {
    txVendorMemberFindFirst.mockResolvedValue({ role: "admin" });
    txVendorMemberCount.mockResolvedValue(1);

    await expect(
      assertCanChangeVendorMembership(
        TEST_VENDOR_ID,
        "user_123",
        "developer",
        tx,
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(txVendorMemberFindFirst).toHaveBeenCalledWith({
      where: { vendorId: TEST_VENDOR_ID, userId: "user_123" },
      select: { role: true },
    });
    expect(txVendorMemberCount).toHaveBeenCalledWith({
      where: { vendorId: TEST_VENDOR_ID, role: "admin" },
    });
    expect(vendorMemberFindFirstMock).not.toHaveBeenCalled();
    expect(vendorMemberCountMock).not.toHaveBeenCalled();
  });

  it("locks the Vendor before reading a membership role change", async () => {
    txVendorMemberFindFirst.mockResolvedValue({ role: "developer" });

    await expect(
      assertCanChangeVendorMembership(TEST_VENDOR_ID, "user_123", "admin", tx),
    ).resolves.toBeUndefined();

    const [lockStrings, ...lockValues] = txQueryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(lockStrings.join("?")).toMatch(
      /FROM "vendor"[\s\S]*WHERE "id" = \?[\s\S]*FOR UPDATE/,
    );
    expect(lockValues).toEqual([TEST_VENDOR_ID]);
    expect(txQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txVendorMemberFindFirst.mock.invocationCallOrder[0],
    );
    expect(txVendorMemberCount).not.toHaveBeenCalled();
  });
});
