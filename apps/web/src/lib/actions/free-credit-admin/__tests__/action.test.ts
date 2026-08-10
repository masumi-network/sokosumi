import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const grantFreeCreditsMock = vi.fn();
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

vi.mock("@/lib/services/free-credit-admin.service", () => {
  class FreeCreditValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FreeCreditValidationError";
    }
  }

  return {
    FreeCreditValidationError,
    freeCreditAdminService: {
      grantFreeCredits: (...args: unknown[]) => grantFreeCreditsMock(...args),
    },
  };
});

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { FreeCreditValidationError } from "@/lib/services/free-credit-admin.service";

import { grantFreeCreditsAction } from "../action";

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

describe("grantFreeCreditsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the grant and revalidates admin pages on success", async () => {
    grantFreeCreditsMock.mockResolvedValue(GRANT);

    const result = await grantFreeCreditsAction({
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
    expect(result.value).toEqual(GRANT);
    expect(grantFreeCreditsMock).toHaveBeenCalledWith({
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
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/tasks");
  });

  it("maps a FreeCreditValidationError to BAD_INPUT", async () => {
    grantFreeCreditsMock.mockRejectedValue(
      new FreeCreditValidationError("Credits must be a positive integer"),
    );

    const result = await grantFreeCreditsAction({
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
    grantFreeCreditsMock.mockRejectedValue(
      new CoreApiRequestError("boom", { status: 500 }),
    );

    const result = await grantFreeCreditsAction({
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

    const result = await grantFreeCreditsAction({
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
    expect(grantFreeCreditsMock).not.toHaveBeenCalled();
  });
});
