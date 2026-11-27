import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskFindManyMock,
  delegationFindManyMock,
  createManyMock,
  txCreate,
  queryRaw,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  createManyMock: vi.fn(),
  txCreate: vi.fn(),
  queryRaw: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_ENABLED: true, NETWORK_PREPROD_ENABLED: true }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (run: (tx: unknown) => unknown) =>
      run({
        $queryRaw: queryRaw,
        sokoBotDelegation: { createMany: txCreate },
      }),
    task: { findMany: taskFindManyMock },
    sokoBotDelegation: {
      findMany: delegationFindManyMock,
      createMany: createManyMock,
    },
  },
}));

import {
  PREPROD_GENERATION_KEY,
  PREPROD_PAUSE_KEY,
} from "@/helpers/preprod-control";
import { adoptCoworkerSpawnedTasks } from "./soko-bot-spawned-task-adoption.service";

const subtask = {
  id: "task_hannah",
  createdAt: new Date("2026-10-26T15:14:47Z"),
  ownerId: "user_1",
  workspaceId: "ws_1",
  assigneeId: "coworker_hannah",
};

const parent = (assigneeId: string, status: string, sokoBotId = "bot_1") => ({
  turnId: `turn_${sokoBotId}_${assigneeId}`,
  turn: { sokoBotId, network: "mainnet", preprodGeneration: null },
  task: { assigneeId, events: [{ status }] },
});

describe("adoptCoworkerSpawnedTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([subtask]);
    createManyMock.mockResolvedValue({ count: 1 });
  });

  it("follows a Task a Coworker started while the bot's delegated Task was running", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "RUNNING"),
    ]);
    expect(await adoptCoworkerSpawnedTasks()).toBe(1);
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
          network: "mainnet",
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

  it.each([
    ["open", 3, 1],
    ["open", 4, 0],
    ["paused", 3, 0],
  ] as const)(
    "checks %s generation %s before adopting for a Preprod turn",
    async (pause, generation, count) => {
      const source = parent("coworker_elena", "RUNNING");
      delegationFindManyMock.mockResolvedValue([
        {
          ...source,
          turn: { ...source.turn, network: "preprod", preprodGeneration: 3 },
        },
      ]);
      queryRaw.mockResolvedValueOnce([
        { key: PREPROD_PAUSE_KEY, cursorId: pause },
      ]);
      queryRaw.mockResolvedValueOnce([
        { key: PREPROD_GENERATION_KEY, cursorId: String(generation) },
      ]);
      txCreate.mockResolvedValue({ count: 1 });
      expect(await adoptCoworkerSpawnedTasks()).toBe(count);
      expect(createManyMock).not.toHaveBeenCalled();
      if (count) {
        expect(txCreate).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            data: expect.objectContaining({
              network: "preprod",
              preprodGeneration: 3,
            }),
          }),
        );
      } else {
        expect(txCreate).not.toHaveBeenCalled();
      }
    },
  );

  it("leaves Tasks alone that appeared while no delegated work was running", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "INPUT_REQUIRED"),
      parent("coworker_elena", "COMPLETED"),
    ]);
    expect(await adoptCoworkerSpawnedTasks()).toBe(0);
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("does not count the sub-task's own Coworker as its source", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_hannah", "RUNNING"),
    ]);
    expect(await adoptCoworkerSpawnedTasks()).toBe(0);
  });

  it("adds one delegation per bot", async () => {
    delegationFindManyMock.mockResolvedValue([
      parent("coworker_elena", "RUNNING"),
      parent("coworker_alex", "RUNNING"),
      parent("coworker_elena", "RUNNING", "bot_2"),
    ]);
    createManyMock.mockResolvedValue({ count: 2 });
    expect(await adoptCoworkerSpawnedTasks()).toBe(2);
    expect(createManyMock.mock.calls[0][0].data).toHaveLength(2);
  });
});
