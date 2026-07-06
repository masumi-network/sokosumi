import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserByIdMock = vi.fn();
const getOrganizationWithRelationsByIdMock = vi.fn();
const getOrganizationOwnerUserIdMock = vi.fn();
const grantSupportCreditsMock = vi.fn();
const getCreditExpiryDateMock = vi.fn();
const markOutOfCreditsTasksAsToppedUpMock = vi.fn();
const randomUUIDMock = vi.fn();

vi.mock("node:crypto", () => ({
  randomUUID: () => randomUUIDMock(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  grantSupportCredits: (...args: unknown[]) => grantSupportCreditsMock(...args),
  getCreditExpiryDate: (...args: unknown[]) => getCreditExpiryDateMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getOrganizationOwnerUserId: (...args: unknown[]) =>
      getOrganizationOwnerUserIdMock(...args),
  },
  organizationRepository: {
    getOrganizationWithRelationsById: (...args: unknown[]) =>
      getOrganizationWithRelationsByIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

const transactionMock = vi.fn(async (callback: (tx: unknown) => unknown) =>
  callback({}),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
  },
}));

vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: (...args: unknown[]) =>
    markOutOfCreditsTasksAsToppedUpMock(...args),
}));

import { supportCreditAdminService } from "./support-credit-admin.service";

describe("supportCreditAdminService.grantSupportCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUUIDMock.mockReturnValue("grant-uuid-1");
    grantSupportCreditsMock.mockResolvedValue({ bucketId: "bucket-1" });
    getCreditExpiryDateMock.mockReturnValue(
      new Date("2026-08-01T00:00:00.000Z"),
    );
    markOutOfCreditsTasksAsToppedUpMock.mockResolvedValue(undefined);
  });

  it("grants user support credits inside a transaction", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      name: "Ada",
    });

    const grant = await supportCreditAdminService.grantSupportCredits({
      target: { targetType: "user", targetId: "user-1" },
      credits: 500,
      ttlDays: 30,
      referenceNote: "Help",
    });

    expect(grant).toEqual({
      bucketId: "bucket-1",
      targetType: "user",
      targetId: "user-1",
      targetName: "Ada",
      credits: 500,
      ttlDays: 30,
      referenceNote: "Help",
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(grantSupportCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 500,
        grantId: "grant-uuid-1",
        organizationId: null,
        referenceNote: "Help",
        targetId: "user-1",
        targetType: "user",
        transactionUserId: "user-1",
      }),
      expect.anything(),
    );
    expect(markOutOfCreditsTasksAsToppedUpMock).toHaveBeenCalledWith({
      organizationId: null,
      tx: expect.anything(),
      userId: "user-1",
    });
  });

  it("grants organization support credits against the owner user", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org-1",
      name: "Acme",
    });
    getOrganizationOwnerUserIdMock.mockResolvedValue("owner-1");

    const grant = await supportCreditAdminService.grantSupportCredits({
      target: { targetType: "organization", targetId: "org-1" },
      credits: 250,
      ttlDays: null,
      referenceNote: null,
    });

    expect(grant.targetType).toBe("organization");
    expect(grant.targetId).toBe("org-1");
    expect(grantSupportCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        targetType: "organization",
        transactionUserId: "owner-1",
      }),
      expect.anything(),
    );
    expect(markOutOfCreditsTasksAsToppedUpMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tx: expect.anything(),
      userId: "owner-1",
    });
  });

  it("throws when the user is not found", async () => {
    getUserByIdMock.mockResolvedValue(null);

    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "user", targetId: "missing" },
        credits: 100,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toMatchObject({
      name: "SupportCreditValidationError",
      message: "User not found",
    });
  });

  it("throws when the organization is not found", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue(null);

    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "organization", targetId: "missing" },
        credits: 100,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toThrow("Organization not found");
  });

  it("throws when the organization has no owner", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org-1",
      name: "Acme",
    });
    getOrganizationOwnerUserIdMock.mockResolvedValue(null);

    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "organization", targetId: "org-1" },
        credits: 100,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toThrow("Organization has no owner");
  });

  it("throws for invalid credits before opening a transaction", async () => {
    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "user", targetId: "user-1" },
        credits: 0,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toThrow("Credits must be a positive integer");

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("throws when ttlDays exceeds the maximum", async () => {
    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "user", targetId: "user-1" },
        credits: 100,
        ttlDays: 3651,
        referenceNote: null,
      }),
    ).rejects.toThrow(/Expiry must be a positive integer/);

    expect(transactionMock).not.toHaveBeenCalled();
  });
});
