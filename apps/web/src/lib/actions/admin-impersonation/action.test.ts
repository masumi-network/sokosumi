import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const startImpersonationMock = vi.fn();
const stopImpersonationMock = vi.fn();

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

vi.mock("@/lib/services/admin-impersonation.service", () => {
  class ImpersonationValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ImpersonationValidationError";
    }
  }

  return {
    ImpersonationValidationError,
    adminImpersonationService: {
      startImpersonation: (...args: unknown[]) =>
        startImpersonationMock(...args),
      stopImpersonation: (...args: unknown[]) => stopImpersonationMock(...args),
    },
  };
});

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { ImpersonationValidationError } from "@/lib/services/admin-impersonation.service";

import { startImpersonationAction, stopImpersonationAction } from "./action";

const TARGET_USER = {
  id: "user_target",
  name: "Target User",
  email: "target@example.com",
};

const ADMIN_USER = {
  id: "user_admin",
  name: "Admin User",
  email: "admin@example.com",
};

const adminSession = {
  user: { id: "user_admin", role: "admin" },
  session: { id: "sess_admin", userId: "user_admin" },
} as never;

const plainSession = {
  user: { id: "user_plain", role: "user" },
  session: { id: "sess_plain", userId: "user_plain" },
} as never;

const impersonatedSession = {
  user: { id: TARGET_USER.id, role: "user" },
  session: {
    id: "sess_impersonated",
    userId: TARGET_USER.id,
    impersonatedBy: "user_admin",
  },
} as never;

describe("startImpersonationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts an impersonation for an admin session", async () => {
    startImpersonationMock.mockResolvedValue(TARGET_USER);

    const result = await startImpersonationAction({
      session: adminSession,
      userId: TARGET_USER.id,
      reason: "SOK-1080: reproduce reported bug",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }
    expect(result.value).toEqual(TARGET_USER);
    expect(startImpersonationMock).toHaveBeenCalledWith({
      userId: TARGET_USER.id,
      reason: "SOK-1080: reproduce reported bug",
    });
  });

  it("rejects a second impersonation while one is active", async () => {
    const result = await startImpersonationAction({
      session: impersonatedSession,
      userId: "user_other",
      reason: "SOK-1: x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error).toMatchObject({
      code: CommonErrorCode.BAD_INPUT,
      message:
        "Already impersonating a user. Stop the current impersonation first.",
    });
    expect(startImpersonationMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin sessions without calling the service", async () => {
    const result = await startImpersonationAction({
      session: plainSession,
      userId: TARGET_USER.id,
      reason: "SOK-1: x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(startImpersonationMock).not.toHaveBeenCalled();
  });

  it("maps validation errors to bad input", async () => {
    startImpersonationMock.mockRejectedValue(
      new ImpersonationValidationError("Reason is required"),
    );

    const result = await startImpersonationAction({
      session: adminSession,
      userId: TARGET_USER.id,
      reason: "   ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error).toMatchObject({
      code: CommonErrorCode.BAD_INPUT,
      message: "Reason is required",
    });
  });

  it("maps Core conflicts to bad input with Core's message", async () => {
    startImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Already impersonating a user", { status: 409 }),
    );

    const result = await startImpersonationAction({
      session: adminSession,
      userId: TARGET_USER.id,
      reason: "SOK-1: x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error).toMatchObject({
      code: CommonErrorCode.BAD_INPUT,
      message: "Already impersonating a user",
    });
  });

  it("maps Core forbidden to unauthorized", async () => {
    startImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Admin users cannot be impersonated", {
        status: 403,
      }),
    );

    const result = await startImpersonationAction({
      session: adminSession,
      userId: "user_other_admin",
      reason: "SOK-1: x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error).toMatchObject({
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Admin users cannot be impersonated",
    });
  });
});

describe("stopImpersonationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops an impersonation for a non-admin (impersonated) session", async () => {
    stopImpersonationMock.mockResolvedValue(ADMIN_USER);

    const result = await stopImpersonationAction({
      session: impersonatedSession,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }
    expect(result.value).toEqual(ADMIN_USER);
    expect(stopImpersonationMock).toHaveBeenCalledWith();
  });

  it("maps Core errors with Core's message", async () => {
    stopImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Not currently impersonating a user", {
        status: 400,
      }),
    );

    const result = await stopImpersonationAction({
      session: plainSession,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }
    expect(result.error).toMatchObject({
      code: CommonErrorCode.BAD_INPUT,
      message: "Not currently impersonating a user",
    });
  });
});
