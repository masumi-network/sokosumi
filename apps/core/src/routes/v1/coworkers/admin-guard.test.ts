import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireCoworkerAdminAuthContext } from "./admin-guard";

const { userFindUniqueMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

describe("requireCoworkerAdminAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows user role admin", async () => {
    userFindUniqueMock.mockResolvedValue({
      role: "admin",
    });

    await expect(
      requireCoworkerAdminAuthContext({
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
      requireCoworkerAdminAuthContext({
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
      requireCoworkerAdminAuthContext({
        actor: "user",
        userId: "user_123",
        organizationId: null,
      }),
    ).rejects.toMatchObject<Partial<HTTPException>>({
      status: 403,
      message: "Admin access required",
    });
  });

  it("rejects coworker actor", async () => {
    await expect(
      requireCoworkerAdminAuthContext({
        actor: "coworker",
        coworkerId: "cow_123",
      }),
    ).rejects.toMatchObject<Partial<HTTPException>>({
      status: 403,
      message: "User authentication required",
    });

    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });
});
