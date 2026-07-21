import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";
import {
  buildCoworkerMutationWhere,
  requireCoworkerManagementAccess,
} from "./coworker-management-access";

const { coworkerFindFirstMock } = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

describe("buildCoworkerMutationWhere", () => {
  it("requires active coworker when archived is not allowed", () => {
    expect(buildCoworkerMutationWhere("cow_123", false)).toEqual({
      id: "cow_123",
      archivedAt: null,
    });
  });

  it("allows archived coworker when admin bypass is enabled", () => {
    expect(buildCoworkerMutationWhere("cow_123", true)).toEqual({
      id: "cow_123",
    });
  });
});

describe("requireCoworkerManagementAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows coworker owner when user is not admin", async () => {
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
          role: "user",
        },
        "cow_123",
      ),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
  });

  it("rejects non-owner when user is not admin", async () => {
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
          role: "user",
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "You can only manage your own coworkers",
    } satisfies Partial<HTTPException>);
  });

  it("allows admin regardless of coworker ownership", async () => {
    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
          role: "admin",
        },
        "cow_123",
      ),
    ).resolves.toEqual({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "admin",
    });

    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 404 when coworker does not exist for non-admin", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "user",
          userId: "user_123",
          organizationId: null,
          role: "user",
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 404,
      message: "Coworker not found",
    } satisfies Partial<HTTPException>);
  });

  it("rejects coworker actor", async () => {
    await expect(
      requireCoworkerManagementAccess(
        {
          actor: "coworker",
          coworkerId: "cow_123",
          vendorId: TEST_VENDOR_ID,
        },
        "cow_123",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "User authentication required",
    } satisfies Partial<HTTPException>);

    expect(coworkerFindFirstMock).not.toHaveBeenCalled();
  });
});
