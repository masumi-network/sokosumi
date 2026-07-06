import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const grantSupportCreditsMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/support-credit-admin.service", () => {
  class SupportCreditValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SupportCreditValidationError";
    }
  }

  return {
    SupportCreditValidationError,
    supportCreditAdminService: {
      grantSupportCredits: (...args: unknown[]) =>
        grantSupportCreditsMock(...args),
    },
  };
});

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.shared";
import { SupportCreditValidationError } from "@/lib/services/support-credit-admin.service";

import { grantSupportCreditsAction } from "../action";

const GRANT = {
  bucketId: "bucket_1",
  targetType: "user" as const,
  targetId: "user_1",
  targetName: "Ada",
  credits: 500,
  ttlDays: null,
  referenceNote: "Help",
};

const adminSession = {
  user: {
    id: "admin-1",
    role: "admin",
  },
} as never;

describe("grantSupportCreditsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the grant and revalidates admin pages on success", async () => {
    grantSupportCreditsMock.mockResolvedValue(GRANT);

    const result = await grantSupportCreditsAction({
      session: adminSession,
      targetType: "user",
      targetId: "user_1",
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }
    expect(result.data).toEqual(GRANT);
    expect(grantSupportCreditsMock).toHaveBeenCalledWith({
      target: { targetType: "user", targetId: "user_1" },
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/free-credits");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/organizations",
      "layout",
    );
  });

  it("maps a SupportCreditValidationError to BAD_INPUT", async () => {
    grantSupportCreditsMock.mockRejectedValue(
      new SupportCreditValidationError("Credits must be a positive integer"),
    );

    const result = await grantSupportCreditsAction({
      session: adminSession,
      targetType: "user",
      targetId: "user_1",
      credits: 0,
      ttlDays: null,
      referenceNote: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
    expect(result.error.message).toBe("Credits must be a positive integer");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("maps other core errors to INTERNAL_SERVER_ERROR", async () => {
    grantSupportCreditsMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    const result = await grantSupportCreditsAction({
      session: adminSession,
      targetType: "user",
      targetId: "user_1",
      credits: 500,
      ttlDays: null,
      referenceNote: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("returns UNAUTHORIZED for non-admin sessions", async () => {
    const memberSession = {
      user: {
        id: "user-1",
        role: "user",
      },
    } as never;

    const result = await grantSupportCreditsAction({
      session: memberSession,
      targetType: "user",
      targetId: "user_1",
      credits: 500,
      ttlDays: null,
      referenceNote: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(grantSupportCreditsMock).not.toHaveBeenCalled();
  });
});
