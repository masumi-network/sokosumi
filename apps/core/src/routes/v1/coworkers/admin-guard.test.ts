import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  requireAdminAuthContext,
  requireCoworkerManagementAccess,
} from "./admin-guard";

const { userFindUniqueMock, coworkerFindFirstMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

describe("requireAdminAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows user role admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });

    await expect(
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
      }),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
  });

  it("allows comma-separated roles that include admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "user, admin",
    });

    await expect(
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
      }),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
  });

  it("rejects missing admin role", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });

    await expect(
      requireAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Admin access required",
    });
  });

  it("rejects coworker actor", async () => {
    await expect(
      requireAdminAuthContext({
        actor: "coworker",
        coworkerId: "cow_123",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "User authentication required",
    });

    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("requireCoworkerManagementAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows coworker owner when user is not admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      userId: "user_123",
    });

    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
        },
        "cow_123",
      ),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
  });

  it("rejects non-owner when user is not admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      userId: "user_999",
    });

    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "You can only manage your own coworkers",
    });
  });

  it("allows admin regardless of coworker ownership", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });

    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
        },
        "cow_123",
      ),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });

    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 404 when coworker does not exist for non-admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "user",
    });
    coworkerFindFirstMock.mockResolvedValue(null);

    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 404,
      message: "Coworker not found",
    });
  });

  it("rejects coworker actor", async () => {
    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "coworker",
          coworkerId: "cow_123",
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "User authentication required",
    });

    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });
});
