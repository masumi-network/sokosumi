import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskCountMock,
  taskFindManyMock,
  eventFindManyMock,
  messageCountMock,
  turnCountMock,
  usageAggregateMock,
} = vi.hoisted(() => ({
  taskCountMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  eventFindManyMock: vi.fn(),
  messageCountMock: vi.fn(),
  turnCountMock: vi.fn(),
  usageAggregateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { count: taskCountMock, findMany: taskFindManyMock },
    taskEvent: { findMany: eventFindManyMock },
    chatRoomMessage: { count: messageCountMock },
    sokoBotTurn: { count: turnCountMock },
    sokoBotUsage: { aggregate: usageAggregateMock },
  },
}));

import {
  buildNotResponsibleUserWhere,
  buildResponsibleUserWhere,
} from "@/helpers/task-visibility";

import { activityStats } from "./soko-bot-activity-stats.service";

const bot = {
  id: "bot-1",
  name: "Jarvis",
  userId: "andreas",
  workspaceId: "ws",
};
const since = new Date("2026-09-01T00:00:00Z");
const until = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  taskCountMock.mockResolvedValue(12);
  messageCountMock.mockImplementation(async ({ where }) =>
    where.senderUserId ? 42 : 80,
  );
  turnCountMock.mockResolvedValue(120);
  usageAggregateMock.mockResolvedValue({ _sum: { cents: 4_550_000n } });
  // Teammates' work is named after its responsible person (ADR 0056).
  const albina = { creatorUserId: "albina", creatorUser: { name: "Albina" } };
  const keanu = {
    creatorUserId: null,
    requestedByUserId: "keanu",
    requestedByUser: { name: "Keanu Klestil" },
  };
  taskFindManyMock.mockResolvedValue([albina, albina, keanu]);
  eventFindManyMock.mockImplementation(async ({ where }) => {
    if (where.transaction) {
      return [
        {
          transaction: { amount: -10_000_000n },
          task: { assignee: { name: "Hannah" } },
        },
        {
          transaction: { amount: -2_131_000n },
          task: { assignee: { name: "Hannah" } },
        },
      ];
    }
    if (JSON.stringify(where.task).includes('"not":"andreas"')) {
      return [
        {
          taskId: "t1",
          task: { creatorUserId: "albina", creatorUser: { name: "Albina" } },
        },
      ];
    }
    if (where.status === "FAILED") return [{ taskId: "f" }];
    if (where.task?.sokoBotDelegations) return [{ taskId: "a" }];
    return [{ taskId: "a" }, { taskId: "b" }];
  });
});

describe("activityStats", () => {
  it("counts the person's work, the bot's and the team's in the window", async () => {
    const stats = await activityStats(bot, since, until);
    expect(stats.own).toEqual({
      created: 12,
      completed: 2,
      failed: 1,
      viaBot: 1,
    });
    expect(stats.ownerMessages).toBe(42);
    expect(stats.botTurns).toBe(120);
    expect(stats.botMessages).toBe(80);
    expect(stats.coworkerCredits[0]?.name).toBe("Hannah");
    expect(stats.team).toEqual([
      { name: "Albina", completed: 1, created: 2 },
      { name: "Keanu Klestil", completed: 0, created: 1 },
    ]);
    // Work the bot's person is responsible for, and teammates' work, which
    // respects private-Task visibility.
    expect(taskCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: "ws",
        AND: [buildResponsibleUserWhere("andreas")],
      }),
    });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [expect.anything(), buildNotResponsibleUserWhere("andreas")],
        }),
      }),
    );
  });
});
