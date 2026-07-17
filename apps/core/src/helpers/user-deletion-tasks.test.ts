import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const { findManyMock, updateMock, deleteManyMock, transactionMock } =
  vi.hoisted(() => ({
    findManyMock: vi.fn(),
    updateMock: vi.fn(),
    deleteManyMock: vi.fn(),
    transactionMock: vi.fn(),
  }));

describe("prepareTasksForUserDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) =>
      callback({
        task: {
          findMany: findManyMock,
          update: updateMock,
          deleteMany: deleteManyMock,
        },
      }),
    );
  });

  it("reassigns foreign-owned creators then deletes owned tasks", async () => {
    findManyMock.mockResolvedValue([
      { id: "tsk_owned", ownerId: "user_delete" },
      { id: "tsk_other", ownerId: "user_other" },
    ]);
    updateMock.mockResolvedValue({});
    deleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "tsk_other" },
      data: { creatorUserId: "user_other" },
    });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { ownerId: "user_delete" },
    });
  });
});
