import { beforeEach, describe, expect, it, vi } from "vitest";

const { botFindMany, taskFindMany } = vi.hoisted(() => ({
  botFindMany: vi.fn(),
  taskFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotSchedule: { findMany: botFindMany },
    taskSchedule: { findMany: taskFindMany },
  },
}));
vi.mock("@/services/task-schedule-read.service", () => ({
  SCHEDULE_ASSIGNEE_VENDOR: {},
  canWriteTaskSchedule: () => true,
  taskScheduleVisibilityWhere: () => ({ visible: true }),
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { listSchedules } from "./schedule-reads";

const AT = new Date("2026-07-01T09:00:00Z");

function authorized(askedByKind = "OWNER") {
  return {
    turn: {
      sokoBotId: "joseph",
      workspaceId: "ws-1",
      actingUserId: "patrick",
      source: "CHAT",
      chainDepth: 0,
    },
    askedByKind,
    reader: { sharedScope: null },
  } as unknown as AuthorizedSokoBotRuntime;
}

function botRow(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    name: "Weekly check",
    enabled: true,
    timezone: "Europe/Zurich",
    cronExpression: "0 9 * * 1",
    runOnce: false,
    prompt: "Check it",
    systemKey: null,
    createdAt: AT,
    nextRunAt: AT,
    lastRunAt: AT,
    consecutiveFailures: 0,
    taskId: null,
    jobId: null,
    sokoBotId: "joseph",
    requestedByUserId: "patrick",
    requestedBy: { name: "Patrick" },
    sokoBot: { name: "Joseph" },
    runs: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  botFindMany.mockResolvedValue([]);
  taskFindMany.mockResolvedValue([]);
});

describe("listSchedules", () => {
  it("says who made each of the bot's own schedules and how it last ran", async () => {
    botFindMany.mockResolvedValue([
      botRow({
        requestedByUserId: "jami",
        requestedBy: { name: "Jami" },
        consecutiveFailures: 2,
        runs: [{ status: "FAILED", errorKind: "TIMEOUT" }],
      }),
      botRow({ id: "s2", systemKey: "standup", requestedByUserId: null }),
    ]);
    const result = (await listSchedules(authorized(), {})) as {
      schedules: Record<string, unknown>[];
    };
    expect(botFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      sokoBotId: "joseph",
    });
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(result.schedules[0]).toEqual(
      expect.objectContaining({
        createdBy: "Jami",
        createdBySomeoneElse: true,
        runsOn: "you",
        lastResult: "failed (TIMEOUT)",
        failuresInARow: 2,
        youCanChange: true,
      }),
    );
    expect(result.schedules[1]?.createdBy).toBe("built-in rhythm");
  });

  it("adds Task Schedules and other bots' schedules for the whole workspace, changeable only by their owners", async () => {
    botFindMany.mockResolvedValue([
      botRow({ id: "s3", sokoBotId: "team-bot", sokoBot: { name: "Ops" } }),
    ]);
    taskFindMany.mockResolvedValue([
      {
        id: "t1",
        name: "Summer recap",
        creatorUser: { name: "Jami" },
        creatorUserId: "jami",
        creatorSokoBotId: null,
        owner: { name: "Jami" },
        project: null,
        assignee: null,
        assigneeSokoBot: null,
        assigneeUser: null,
        createdAt: AT,
        state: "ACTIVE",
        expr: "0 9 * * 1",
        timezone: "UTC",
        nextRunAt: AT,
        description: "Recap",
        runs: [
          {
            effectiveScheduledAt: AT,
            state: "RELEASED",
            releasedTask: { status: "COMPLETED" },
          },
        ],
      },
    ]);
    const result = (await listSchedules(authorized(), {
      scope: "workspace",
    })) as {
      botSchedules: Record<string, unknown>[];
      taskSchedules: Record<string, unknown>[];
    };
    expect(result.botSchedules[0]).toEqual(
      expect.objectContaining({ runsOn: "Ops", youCanChange: false }),
    );
    expect(result.taskSchedules[0]).toEqual(
      expect.objectContaining({
        kind: "task",
        createdBy: "Jami",
        lastResult: "COMPLETED",
        // Jami's: the owner may write it, so the bot may on the owner's
        // chat turn, after asking.
        youCanChange: true,
        askOwnerFirst: true,
      }),
    );
    expect(taskFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      workspaceId: "ws-1",
      visible: true,
    });
  });

  it("reads the workspace only on the owner's own turn", async () => {
    await expect(
      listSchedules(authorized("TEAMMATE"), { scope: "workspace" }),
    ).rejects.toThrow(/owner's own turn/);
  });
});
