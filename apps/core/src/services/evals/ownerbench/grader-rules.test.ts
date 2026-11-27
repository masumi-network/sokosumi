import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn() },
  sokoBotSchedule: { findMany: vi.fn() },
  taskSchedule: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import { outcomeCheck } from "./journey-checks";
import { failedCallsByRecovery } from "./journey-runner";

const failedEdit = {
  turnId: "turn",
  capability: "update_schedule",
  status: "FAILED",
  input: { scheduleId: "schedule-a" },
};
const later = (capability: string, input: object, turnId = "turn") => ({
  turnId,
  capability,
  status: "COMPLETED",
  input,
});

describe("a refusal recovered in the same turn", () => {
  it.each([
    [
      "editing a different schedule",
      later("update_schedule", { scheduleId: "schedule-b" }),
    ],
    ["listing the schedules", later("list_schedules", {})],
    [
      "the same edit in another turn",
      later("update_schedule", { scheduleId: "schedule-a" }, "other"),
    ],
  ])("is not recovered by %s", async (_reason, call) => {
    db.sokoBotToolCall.findMany.mockResolvedValue([failedEdit, call]);
    expect(await failedCallsByRecovery(["turn", "other"], {})).toEqual({
      unrecovered: ["update_schedule"],
      recovered: [],
    });
  });

  it.each([
    [
      "the same edit on the same schedule",
      later("update_schedule", { scheduleId: "schedule-a" }),
    ],
    [
      "a new schedule beside a built-in one",
      later("create_schedule", { name: "Monday report" }),
    ],
  ])("is recovered by %s", async (_reason, call) => {
    db.sokoBotToolCall.findMany.mockResolvedValue([failedEdit, call]);
    expect(await failedCallsByRecovery(["turn"], {})).toEqual({
      unrecovered: [],
      recovered: ["update_schedule"],
    });
  });
});

describe("a split daily brief", () => {
  it.each([
    ["0 8 * * *", true],
    ["0 8 * * 1", false],
  ])(
    "counts the Coworker's part only on the asked days (%s)",
    async (expr, pass) => {
      const now = new Date("2026-09-01T12:00:00Z");
      db.sokoBotSchedule.findMany.mockResolvedValue([
        {
          id: "local",
          enabled: true,
          cronExpression: "0 9 * * *",
          timezone: "UTC",
          runOnce: false,
          prompt: "Turn the depot counts into a daily chart",
        },
      ]);
      db.taskSchedule.findMany.mockResolvedValue([
        {
          name: "Collect counts",
          description: "Prepare a new inventory count",
          expr,
          assignee: { name: "Analyst" },
        },
      ]);
      const result = await outcomeCheck(
        {
          kind: "schedule",
          label: "New inventory count and chart every day",
          days: [0, 1, 2, 3, 4, 5, 6],
          withTaskSchedules: true,
          promptMatches: ["analyst", "inventory", "chart"],
        },
        {
          lane: { workspaceId: "workspace" },
          botId: "bot",
          memo: {},
          stepStartedAt: now,
          journeyStartedAt: now,
          toolCalls: [],
        } as unknown as Parameters<typeof outcomeCheck>[1],
      );
      expect(result.pass).toBe(pass);
    },
  );
});
