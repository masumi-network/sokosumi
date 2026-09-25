import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  addSelfAsTaskParticipant,
  addTaskParticipantsFromComment,
} from "./task-participants";

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

  it("does not load workspace members when the comment mentions no one", async () => {
    const findUnique = vi.fn();
    const added = await addTaskParticipantsFromComment(
      {
        workspace: { findUnique },
        taskParticipant: { findMany: vi.fn(), createMany: vi.fn() },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        comment: "looks good to me",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        mentionedUserIds: [],
      },
    );

    expect(added).toEqual([]);
    expect(findUnique).not.toHaveBeenCalled();
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
        excludeUserId: "user_alice",
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

  it("skips the human comment author when they mention themselves", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
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
          findMany: vi.fn().mockResolvedValue([]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        comment: "@user_owner @user_alice",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        excludeUserId: "user_owner",
        mentionedUserIds: ["user_owner", "user_alice"],
      },
    );

    expect(added).toEqual(["user_alice"]);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: "tsk_1", userId: "user_alice" }],
      skipDuplicates: true,
    });
  });
});

describe("addSelfAsTaskParticipant", () => {
  it("inserts the viewer when they are a workspace member", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const result = await addSelfAsTaskParticipant(
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
          findMany: vi.fn().mockResolvedValue([]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        userId: "user_alice",
      },
    );

    expect(result).toEqual({ added: true });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: "tsk_1", userId: "user_alice" }],
      skipDuplicates: true,
    });
  });

  it("is a no-op when the viewer is already a participant", async () => {
    const createMany = vi.fn();
    const result = await addSelfAsTaskParticipant(
      {
        workspace: {
          findUnique: vi
            .fn()
            .mockResolvedValue(
              workspaceOf([{ id: "user_alice", name: "Alice" }]),
            ),
        },
        taskParticipant: {
          findMany: vi.fn().mockResolvedValue([{ userId: "user_alice" }]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        userId: "user_alice",
      },
    );

    expect(result).toEqual({ added: false });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("skips non-members and PRIVATE non-owners", async () => {
    const createMany = vi.fn();
    const nonMember = await addSelfAsTaskParticipant(
      {
        workspace: {
          findUnique: vi
            .fn()
            .mockResolvedValue(workspaceOf([{ id: "user_bob", name: "Bob" }])),
        },
        taskParticipant: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        visibility: TaskVisibility.PUBLIC,
        ownerId: "user_owner",
        userId: "user_alice",
      },
    );
    const privateOther = await addSelfAsTaskParticipant(
      {
        workspace: {
          findUnique: vi
            .fn()
            .mockResolvedValue(
              workspaceOf([{ id: "user_alice", name: "Alice" }]),
            ),
        },
        taskParticipant: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany,
        },
      },
      {
        taskId: "tsk_1",
        workspaceId: "ws_1",
        visibility: TaskVisibility.PRIVATE,
        ownerId: "user_owner",
        userId: "user_alice",
      },
    );

    expect(nonMember).toEqual({ added: false });
    expect(privateOther).toEqual({ added: false });
    expect(createMany).not.toHaveBeenCalled();
  });
});
