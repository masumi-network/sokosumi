import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  coworkerAssignmentFindUniqueMock,
  vendorGrantFindFirstMock,
  taskFindFirstMock,
} = vi.hoisted(() => ({
  coworkerAssignmentFindUniqueMock: vi.fn(),
  vendorGrantFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerAssignment: { findUnique: coworkerAssignmentFindUniqueMock },
    vendorGrant: { findFirst: vendorGrantFindFirstMock },
    task: { findFirst: taskFindFirstMock },
  },
}));

import { hasCoworkerUserDelegation } from "@/middleware/coworker-delegation";

const params = {
  coworkerId: "cow_1",
  vendorId: "ven_1",
  userId: "user_1",
};

describe("hasCoworkerUserDelegation", () => {
  beforeEach(() => {
    coworkerAssignmentFindUniqueMock.mockReset().mockResolvedValue(null);
    vendorGrantFindFirstMock.mockReset().mockResolvedValue(null);
    taskFindFirstMock.mockReset().mockResolvedValue(null);
  });

  it("denies a coworker with no relationship to the user", async () => {
    await expect(hasCoworkerUserDelegation(params)).resolves.toBe(false);
  });

  it("allows an assigned coworker", async () => {
    coworkerAssignmentFindUniqueMock.mockResolvedValue({ id: "assign_1" });

    await expect(hasCoworkerUserDelegation(params)).resolves.toBe(true);
    expect(coworkerAssignmentFindUniqueMock).toHaveBeenCalledWith({
      where: { coworkerId_userId: { coworkerId: "cow_1", userId: "user_1" } },
      select: { id: true },
    });
  });

  it("allows a vendor holding a workspace grant", async () => {
    vendorGrantFindFirstMock.mockResolvedValue({ id: "grant_1" });

    await expect(hasCoworkerUserDelegation(params)).resolves.toBe(true);
  });

  it("requires GRANTED — a PENDING grant must not confer context", async () => {
    // A vendor with any one relationship causes a PENDING grant to be created
    // on the workspace; counting it would hand that vendor context for every
    // other member of the same organization before a human approved anything.
    await expect(hasCoworkerUserDelegation(params)).resolves.toBe(false);

    const where = vendorGrantFindFirstMock.mock.calls[0]?.[0]?.where;
    expect(where.status).toBe("GRANTED");
  });

  it("allows a coworker already assigned to one of the user's tasks", async () => {
    taskFindFirstMock.mockResolvedValue({ id: "task_1" });

    await expect(hasCoworkerUserDelegation(params)).resolves.toBe(true);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: { assigneeId: "cow_1", ownerId: "user_1" },
      select: { id: true },
    });
  });
});
