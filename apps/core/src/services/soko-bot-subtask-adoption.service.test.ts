import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskFindManyMock, delegationFindManyMock, createManyMock } = vi.hoisted(
  () => ({
    taskFindManyMock: vi.fn(),
    delegationFindManyMock: vi.fn(),
    createManyMock: vi.fn(),
  }),
);
vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_ENABLED: true }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    sokoBotDelegation: {
      findMany: delegationFindManyMock,
      createMany: createManyMock,
    },
  },
}));

import { adoptCoworkerSubtasks } from "./soko-bot-subtask-adoption.service";

const subtask = {
  id: "task_hannah",
  createdAt: new Date("2026-10-26T15:14:47Z"),
  ownerId: "user_1",
  workspaceId: "ws_1",
  assigneeId: "coworker_hannah",
};

const parent = (assigneeId: string, status: string, sokoBotId = "bot_1") => ({
  turnId: `turn_${sokoBotId}_${assigneeId}`,
  turn: { sokoBotId },
  task: { assigneeId, events: [{ status }] },
});

describe("adoptCoworkerSubtasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([subtask]);
    createManyMock.mockResolvedValue({ count: 1 });
  });

  it("follows a Task a Coworker started while the bot's delegated Task was running", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "RUNNING"),
    ]);
    expect(await adoptCoworkerSubtasks()).toBe(1);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creatorCoworkerId: { not: null },
          scheduleId: null,
          sokoBotDelegations: { none: { action: { not: "reply_to_task" } } },
        }),
      }),
    );
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          turnId: "turn_bot_1_coworker_elena",
          toolCallId: "subtask:task_hannah",
          kind: "TASK",
          action: "follow_subtask",
          taskId: "task_hannah",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("leaves Tasks alone that appeared while no delegated work was running", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "INPUT_REQUIRED"),
      parent("coworker_elena", "COMPLETED"),
    ]);
    expect(await adoptCoworkerSubtasks()).toBe(0);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("does not count the sub-task's own Coworker as its source", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_hannah", "RUNNING"),
    ]);
    expect(await adoptCoworkerSubtasks()).toBe(0);
  });

  it("adds one delegation per bot", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "RUNNING"),
      parent("coworker_alex", "RUNNING"),
      parent("coworker_elena", "RUNNING", "bot_2"),
    ]);
    createManyMock.mockResolvedValue({ count: 2 });
    expect(await adoptCoworkerSubtasks()).toBe(2);
    expect(createManyMock.mock.calls[0][0].data).toHaveLength(2);
  });
});
