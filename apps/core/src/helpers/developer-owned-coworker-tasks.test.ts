import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDeveloperOwnedCoworkerTaskWhere,
  requireOwnedCoworkerForFilter,
} from "./developer-owned-coworker-tasks";

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

const accessibleCoworkerWhere = {
  OR: [
    {
      vendor: {
        vendorMembers: {
          some: {
            userId: "user_123",
            role: "admin",
          },
        },
      },
    },
    {
      assignments: {
        some: {
          userId: "user_123",
        },
      },
    },
  ],
};

describe("buildDeveloperOwnedCoworkerTaskWhere", () => {
  it("scopes to non-archived tasks for accessible assignee or creator coworkers", () => {
    expect(buildDeveloperOwnedCoworkerTaskWhere("user_123")).toEqual({
      archivedAt: null,
      OR: [
        { assignee: accessibleCoworkerWhere },
        { creatorCoworker: accessibleCoworkerWhere },
      ],
    });
  });

  it("filters to a specific coworker when coworkerId is provided", () => {
    expect(buildDeveloperOwnedCoworkerTaskWhere("user_123", "cow_456")).toEqual(
      {
        archivedAt: null,
        OR: [{ assigneeId: "cow_456" }, { creatorCoworkerId: "cow_456" }],
      },
    );
  });
});

describe("requireOwnedCoworkerForFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the coworker is accessible to the user", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_456" });

    await expect(
      requireOwnedCoworkerForFilter("user_123", "cow_456"),
    ).resolves.toBeUndefined();

    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_456",
        archivedAt: null,
        ...accessibleCoworkerWhere,
      },
      select: { id: true },
    });
  });

  it("throws 404 when the coworker is not accessible to the user", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    await expect(
      requireOwnedCoworkerForFilter("user_123", "cow_missing"),
    ).rejects.toMatchObject({
      status: 404,
      message: "Coworker not found",
    });
  });
});
