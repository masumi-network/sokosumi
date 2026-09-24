import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { addTaskParticipantsFromComment } from "./task-participants";

function workspaceOf(users: Array<{ id: string; name: string }>) {
  return {
    user: null,
    organization: {
      members: users.map((user) => ({ user })),
    },
  };
}

describe("addTaskParticipantsFromComment", () => {
  it("adds mentioned workspace members and skips people already on the task", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const added = await addTaskParticipantsFromComment(
      {
        workspace: {
          findUnique: vi.fn().mockResolvedValue(
            workspaceOf([
              { id: "user_alice", name: "Alice" },
              { id: "user_bob", name: "Bob" },
            ]),
          ),
        },
        taskParticipant: {
          findMany: vi.fn().mockResolvedValue([{ userId: "user_bob" }]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        comment: "@user_alice @user_bob @user_outside @all",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        mentionedUserIds: ["user_alice", "user_stranger"],
      },
    );

    expect(added).toEqual(["user_alice"]);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: "tsk_1", userId: "user_alice" }],
      skipDuplicates: true,
    });
  });

  it("does not add the workspace when the comment is only @all", async () => {
    const createMany = vi.fn();
    const added = await addTaskParticipantsFromComment(
      {
        workspace: {
          findUnique: vi
            .fn()
            .mockResolvedValue(
              workspaceOf([{ id: "user_alice", name: "Alice" }]),
            ),
        },
        taskParticipant: {
          findMany: vi.fn(),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        comment: "ping @all",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
      },
    );

    expect(added).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("does not add teammates who cannot open a PRIVATE task", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([]);
    const added = await addTaskParticipantsFromComment(
      {
        workspace: {
          findUnique: vi.fn().mockResolvedValue(
            workspaceOf([
              { id: "user_owner", name: "Owner" },
              { id: "user_alice", name: "Alice" },
            ]),
          ),
        },
        taskParticipant: {
          findMany,
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        comment: "@user_alice @user_owner",
        visibility: TaskVisibility.PRIVATE,
        ownerId: "user_owner",
        mentionedUserIds: ["user_alice", "user_owner"],
      },
    );

    expect(added).toEqual(["user_owner"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: "tsk_1", userId: { in: ["user_owner"] } },
      select: { userId: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: "tsk_1", userId: "user_owner" }],
      skipDuplicates: true,
    });
  });
});
