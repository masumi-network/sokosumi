import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createAdminSupportCreditGrantMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    createAdminSupportCreditGrant: (...args: unknown[]) =>
      createAdminSupportCreditGrantMock(...args),
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.shared";

import { supportCreditAdminService } from "../support-credit-admin.service";

const GRANT = {
  bucketId: "bucket_1",
  targetType: "user" as const,
  targetId: "user_1",
  targetName: "Ada",
  credits: 500,
  ttlDays: null,
  referenceNote: "Help",
};

describe("supportCreditAdminService (core client wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants support credits through the core client", async () => {
    createAdminSupportCreditGrantMock.mockResolvedValue({ data: GRANT });

    const grant = await supportCreditAdminService.grantSupportCredits({
      target: { targetType: "user", targetId: "user_1" },
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });

    expect(grant).toEqual(GRANT);
    expect(createAdminSupportCreditGrantMock).toHaveBeenCalledWith({
      targetType: "user",
      targetId: "user_1",
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });
  });

  it("maps a core support_credit_invalid error to SupportCreditValidationError", async () => {
    createAdminSupportCreditGrantMock.mockRejectedValue(
      new CoreApiRequestError("User not found", {
        status: 400,
        kind: "support_credit_invalid",
      }),
    );

    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "user", targetId: "user_missing" },
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toMatchObject({
      name: "SupportCreditValidationError",
      message: "User not found",
    });
  });

  it("rethrows other core errors", async () => {
    createAdminSupportCreditGrantMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    await expect(
      supportCreditAdminService.grantSupportCredits({
        target: { targetType: "user", targetId: "user_1" },
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    ).rejects.toBeInstanceOf(CoreApiRequestError);
  });
});
