import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn() },
  sokoBotSchedule: { findMany: vi.fn() },
  taskSchedule: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import { outcomeCheck, runsOnDays } from "./journey-checks";
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
      "a new schedule beside the refused one",
      later("create_schedule", { name: "Monday report" }),
    ],
  ])(
    "is not recovered by %s (no evidence of the same work)",
    async (_reason, call) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([failedEdit, call]);
      expect((await failedCallsByRecovery(["turn"], {})).recovered).toEqual([]);
    },
  );

  it.each([
    [
      "delete_schedule",
      { scheduleId: "schedule-a" },
      "create_schedule",
      { name: "Weekly receipts" },
    ],
    [
      "upload_file",
      { filename: "invoices.csv" },
      "upload_file",
      { filename: "minutes.md" },
    ],
    [
      "create_social_post",
      { text: "too long" },
      "create_social_post",
      { text: "short" },
    ],
  ])(
    "keeps the failed %s apart from other work",
    async (capability, input, laterCapability, laterInput) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([
        { turnId: "turn", capability, input, status: "FAILED" },
        later(laterCapability, laterInput),
      ]);
      expect(await failedCallsByRecovery(["turn"], {})).toEqual({
        unrecovered: [capability],
        recovered: [],
      });
    },
  );

  it.each([
    [
      "the same edit on the same schedule",
      later("update_schedule", { scheduleId: "schedule-a" }),
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
    ["0 8 1 * *", false],
    ["0 8 * 1 *", false],
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

  it("requires the owner's own scheduled part to run daily as well", async () => {
    const now = new Date("2026-09-01T12:00:00Z");
    db.sokoBotSchedule.findMany.mockResolvedValue([
      {
        id: "local",
        enabled: true,
        cronExpression: "0 9 1 * *",
        timezone: "UTC",
        runOnce: false,
        prompt: "Turn the depot counts into a chart",
      },
    ]);
    db.taskSchedule.findMany.mockResolvedValue([
      {
        name: "Collect counts",
        description: "Prepare a new inventory count",
        expr: "0 8 * * *",
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
    expect(result.pass).toBe(false);
  });
});

describe("what Core schedules daily", () => {
  const every = [0, 1, 2, 3, 4, 5, 6];
  it.each([
    "0 8 * * *",
    "0 8 */1 * *",
    "0 8 * * 0-6",
    "0 8 * * 0,1,2,3,4,5,6",
    "30 7,19 * * *",
  ])("counts %s as daily", (cron) => {
    expect(runsOnDays(cron, every)).toBe(true);
  });
  it.each(["0 8 1 * *", "0 8 * * 1-5", "0 8 */2 * *"])(
    "does not count %s as daily",
    (cron) => {
      expect(runsOnDays(cron, every)).toBe(false);
    },
  );
  it("reads weekday schedules the same way", () => {
    expect(runsOnDays("30 8 * * 1,4", [1, 4])).toBe(true);
    expect(runsOnDays("30 8 * * 1", [1, 4])).toBe(false);
  });
});

describe("a refused prompt edit, then another prompt on the same schedule", () => {
  it.each([
    ["Summarize incoming invoices.", true],
    ["Write a birthday greeting.", false],
  ])("counts %s as the same request: %s", async (prompt, recovered) => {
    const scheduleId = "eeb40ab5-3ac9-4a52-9453-18d2a6c1eddc";
    const shared = { turnId: "turn", capability: "update_schedule" };
    db.sokoBotToolCall.findMany.mockResolvedValue([
      {
        ...shared,
        status: "FAILED",
        input: { scheduleId, prompt: "Summarize incoming invoices." },
      },
      { ...shared, status: "COMPLETED", input: { scheduleId, prompt } },
    ]);
    const result = await failedCallsByRecovery(["turn"], {});
    expect(result.recovered).toEqual(recovered ? ["update_schedule"] : []);
    expect(result.unrecovered).toEqual(recovered ? [] : ["update_schedule"]);
  });
});

describe("a refused change, then another call on the same schedule", () => {
  it.each([
    ["renaming the schedule", { name: "New label" }, false],
    ["disabling the schedule", { enabled: false }, false],
    ["moving to a different hour", { cronExpression: "0 19 * * *" }, false],
    ["retrying the requested time", { cronExpression: "0 16 * * *" }, true],
  ])("scores %s", async (_reason, change, recovers) => {
    const scheduleId = "eeb40ab5-3ac9-4a52-9453-18d2a6c1eddc";
    const call = { turnId: "turn", capability: "update_schedule" };
    db.sokoBotToolCall.findMany.mockResolvedValue([
      {
        ...call,
        status: "FAILED",
        input: { scheduleId, cronExpression: "0 16 * * *" },
      },
      { ...call, status: "COMPLETED", input: { scheduleId, ...change } },
    ]);
    const result = await failedCallsByRecovery(["turn"], {});
    expect(result.recovered).toEqual(recovers ? ["update_schedule"] : []);
    expect(result.unrecovered).toEqual(recovers ? [] : ["update_schedule"]);
  });
});
