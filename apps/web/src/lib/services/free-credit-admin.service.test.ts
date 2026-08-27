import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createAdminFreeCreditGrantMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    createAdminFreeCreditGrant: (...args: unknown[]) =>
      createAdminFreeCreditGrantMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.request";

import { freeCreditAdminService } from "./free-credit-admin.service";

const GRANT = {
  bucketId: "bucket_1",
  targetType: "user" as const,
  targetId: "user_1",
  targetName: "Ada",
  credits: 500,
  ttlDays: null,
  referenceNote: "Help",
};

describe("freeCreditAdminService (core client wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants free credits through the core client", async () => {
    createAdminFreeCreditGrantMock.mockResolvedValue({ data: GRANT });

    const grant = await freeCreditAdminService.grantFreeCredits({
      target: { targetType: "user", targetId: "user_1" },
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });

    expect(grant).toEqual(GRANT);
    expect(createAdminFreeCreditGrantMock).toHaveBeenCalledWith({
      targetType: "user",
      targetId: "user_1",
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });
  });

  it("maps a core free_credit_invalid error to FreeCreditValidationError", async () => {
    createAdminFreeCreditGrantMock.mockRejectedValue(
      new CoreApiRequestError("User not found", {
        status: 400,
        kind: "free_credit_invalid",
      }),
    );

    await expect(
      freeCreditAdminService.grantFreeCredits({
        target: { targetType: "user", targetId: "user_missing" },
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toMatchObject({
      name: "FreeCreditValidationError",
      message: "User not found",
    });
  });

  it("rethrows other core errors", async () => {
    createAdminFreeCreditGrantMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    await expect(
      freeCreditAdminService.grantFreeCredits({
        target: { targetType: "user", targetId: "user_1" },
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toBeInstanceOf(CoreApiRequestError);
  });
});
