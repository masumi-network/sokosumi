import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const {
  coworkerFindManyMock,
  taskFindManyMock,
  taskUpdateMock,
  taskDeleteManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  coworkerFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  taskDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

describe("prepareTasksForUserDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) =>
      callback({
        coworker: {
          findMany: coworkerFindManyMock,
        },
        task: {
          findMany: taskFindManyMock,
          update: taskUpdateMock,
          deleteMany: taskDeleteManyMock,
        },
      }),
    );
  });

  it("reassigns foreign-owned user creators then deletes owned tasks", async () => {
    coworkerFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([
      { id: "tsk_owned", ownerId: "user_delete" },
      { id: "tsk_other", ownerId: "user_other" },
    ]);
    taskUpdateMock.mockResolvedValue({});
    taskDeleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [{ creatorUserId: "user_delete" }],
      },
      select: { id: true, ownerId: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledTimes(1);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "tsk_other" },
      data: {
        creatorUserId: "user_other",
        creatorCoworkerId: null,
        creatorOrchestratorId: null,
      },
    });
    expect(taskDeleteManyMock).toHaveBeenCalledWith({
      where: { ownerId: "user_delete" },
    });
  });

  it("clears coworker-creator RESTRICT refs for foreign-owned tasks", async () => {
    coworkerFindManyMock.mockResolvedValue([{ id: "cow_1" }]);
    taskFindManyMock.mockResolvedValue([
      { id: "tsk_foreign", ownerId: "user_other" },
    ]);
    taskUpdateMock.mockResolvedValue({});
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { creatorUserId: "user_delete" },
          { creatorCoworkerId: { in: ["cow_1"] } },
        ],
      },
      select: { id: true, ownerId: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "tsk_foreign" },
      data: {
        creatorUserId: "user_other",
        creatorCoworkerId: null,
        creatorOrchestratorId: null,
      },
    });
  });
});
