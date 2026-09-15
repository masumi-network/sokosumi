import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const startAdminImpersonationMock = vi.fn();
const stopAdminImpersonationMock = vi.fn();
const cookieSetMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    startAdminImpersonation: (...args: unknown[]) =>
      startAdminImpersonationMock(...args),
    stopAdminImpersonation: (...args: unknown[]) =>
      stopAdminImpersonationMock(...args),
  },
}));

vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => cookiesMock(...args),
}));

import { CoreApiRequestError } from "@/lib/clients/core.request";

import {
  adminImpersonationService,
  ImpersonationValidationError,
} from "./admin-impersonation.service";

const TARGET_USER = {
  id: "user_target",
  name: "Target User",
  email: "target@example.com",
};

function responseWithCookies(...cookies: string[]): Response {
  const response = new Response(null, { status: 201 });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

describe("adminImpersonationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({ set: cookieSetMock });
  });

  describe("startImpersonation", () => {
    it("starts an impersonation and forwards the session cookies", async () => {
      startAdminImpersonationMock.mockResolvedValue({
        data: { data: TARGET_USER },
        response: responseWithCookies(
          "sokosumi.session_token=impersonated; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=Lax",
          "sokosumi.admin_session=admin; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=Lax",
        ),
      });

      const result = await adminImpersonationService.startImpersonation({
        userId: TARGET_USER.id,
        reason: "SOK-1080: reproduce reported bug",
      });

      expect(startAdminImpersonationMock).toHaveBeenCalledWith({
        userId: TARGET_USER.id,
        reason: "SOK-1080: reproduce reported bug",
      });
      expect(result).toEqual(TARGET_USER);
      expect(cookieSetMock).toHaveBeenCalledWith(
        "sokosumi.session_token",
        "impersonated",
        {
          path: "/",
          domain: "example.com",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
        },
      );
      expect(cookieSetMock).toHaveBeenCalledWith(
        "sokosumi.admin_session",
        "admin",
        {
          path: "/",
          domain: "example.com",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
        },
      );
    });

    it("rejects a blank reason without calling Core", async () => {
      await expect(
        adminImpersonationService.startImpersonation({
          userId: TARGET_USER.id,
          reason: "   ",
        }),
      ).rejects.toBeInstanceOf(ImpersonationValidationError);
      expect(startAdminImpersonationMock).not.toHaveBeenCalled();
      expect(cookieSetMock).not.toHaveBeenCalled();
    });

    it("rejects a blank user id without calling Core", async () => {
      await expect(
        adminImpersonationService.startImpersonation({
          userId: "  ",
          reason: "SOK-1: x",
        }),
      ).rejects.toBeInstanceOf(ImpersonationValidationError);
      expect(startAdminImpersonationMock).not.toHaveBeenCalled();
    });

    it("fails when Core returns no session cookie", async () => {
      startAdminImpersonationMock.mockResolvedValue({
        data: { data: TARGET_USER },
        response: new Response(null, { status: 201 }),
      });

      await expect(
        adminImpersonationService.startImpersonation({
          userId: TARGET_USER.id,
          reason: "SOK-1: x",
        }),
      ).rejects.toBeInstanceOf(CoreApiRequestError);
      expect(cookieSetMock).not.toHaveBeenCalled();
    });

    it("fails when Core returns only unparsable cookies", async () => {
      startAdminImpersonationMock.mockResolvedValue({
        data: { data: TARGET_USER },
        response: responseWithCookies("not-a-cookie", "=missing-name"),
      });

      await expect(
        adminImpersonationService.startImpersonation({
          userId: TARGET_USER.id,
          reason: "SOK-1: x",
        }),
      ).rejects.toBeInstanceOf(CoreApiRequestError);
      expect(cookieSetMock).not.toHaveBeenCalled();
    });

    it("propagates Core errors without touching cookies", async () => {
      startAdminImpersonationMock.mockRejectedValue(
        new CoreApiRequestError("Already impersonating a user", {
          status: 409,
        }),
      );

      await expect(
        adminImpersonationService.startImpersonation({
          userId: TARGET_USER.id,
          reason: "SOK-1: x",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(cookieSetMock).not.toHaveBeenCalled();
    });
  });

  describe("stopImpersonation", () => {
    const ADMIN_USER = {
      id: "user_admin",
      name: "Admin User",
      email: "admin@example.com",
    };

    it("stops the impersonation and forwards the restored cookies", async () => {
      stopAdminImpersonationMock.mockResolvedValue({
        data: { data: ADMIN_USER },
        response: responseWithCookies(
          "sokosumi.session_token=admin-restored; Path=/; HttpOnly; Secure; SameSite=Lax",
          "sokosumi.admin_session=; Path=/; Max-Age=0",
        ),
      });

      const result = await adminImpersonationService.stopImpersonation();

      expect(stopAdminImpersonationMock).toHaveBeenCalledWith();
      expect(result).toEqual(ADMIN_USER);
      expect(cookieSetMock).toHaveBeenCalledWith(
        "sokosumi.session_token",
        "admin-restored",
        { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
      );
      // The expired admin_session cookie is forwarded as an overwrite with
      // Max-Age=0 (same attributes) so the browser drops it.
      expect(cookieSetMock).toHaveBeenCalledWith("sokosumi.admin_session", "", {
        path: "/",
        maxAge: 0,
      });
    });

    it("propagates Core errors without touching cookies", async () => {
      stopAdminImpersonationMock.mockRejectedValue(
        new CoreApiRequestError("Not currently impersonating a user", {
          status: 400,
        }),
      );

      await expect(
        adminImpersonationService.stopImpersonation(),
      ).rejects.toMatchObject({ status: 400 });
      expect(cookieSetMock).not.toHaveBeenCalled();
    });
  });
});
