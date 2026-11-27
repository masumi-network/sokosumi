import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getUserAccessMock, getOrganizationAccessMock } = vi.hoisted(() => ({
  getUserAccessMock: vi.fn(),
  getOrganizationAccessMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getAdminUserPreprodAccess: getUserAccessMock,
    getAdminOrganizationPreprodAccess: getOrganizationAccessMock,
  },
}));

import { adminPreprodAccessService } from "./admin-preprod-access.service";

const ACCESS = { enabled: true, changes: [] };

function signInRedirect(): unknown {
  try {
    redirect("/signin");
  } catch (error) {
    return error;
  }
}

describe("adminPreprodAccessService.read", () => {
  beforeEach(() => {
    getUserAccessMock.mockReset();
    getOrganizationAccessMock.mockReset();
  });

  it("answers Core's flag and history for a user and an Organization", async () => {
    getUserAccessMock.mockResolvedValue(ACCESS);
    getOrganizationAccessMock.mockResolvedValue(ACCESS);

    await expect(
      adminPreprodAccessService.read({ type: "user", id: "u1" }),
    ).resolves.toEqual({ status: "found", access: ACCESS });
    await expect(
      adminPreprodAccessService.read({ type: "organization", slug: "acme" }),
    ).resolves.toEqual({ status: "found", access: ACCESS });
    expect(getUserAccessMock).toHaveBeenCalledWith("u1");
    expect(getOrganizationAccessMock).toHaveBeenCalledWith("acme");
  });

  it("answers missing when Core has no such target", async () => {
    getUserAccessMock.mockResolvedValue(null);

    await expect(
      adminPreprodAccessService.read({ type: "user", id: "u1" }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("answers unavailable instead of failing the page when Core does not answer", async () => {
    getUserAccessMock.mockRejectedValue(new Error("Forbidden"));

    await expect(
      adminPreprodAccessService.read({ type: "user", id: "u1" }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("lets a sign-in redirect through", async () => {
    const redirectError = signInRedirect();
    getUserAccessMock.mockRejectedValue(redirectError);

    await expect(
      adminPreprodAccessService.read({ type: "user", id: "u1" }),
    ).rejects.toBe(redirectError);
  });
});
