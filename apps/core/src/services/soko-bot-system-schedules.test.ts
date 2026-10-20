import { SOKO_BOT_SYSTEM_SCHEDULES } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scheduleFindManyMock, scheduleCreateMock } = vi.hoisted(() => ({
  scheduleFindManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotSchedule: {
      findMany: scheduleFindManyMock,
      create: scheduleCreateMock,
    },
  },
}));
vi.mock("@/helpers/cron", () => ({
  computeNextRunWithMinimumInterval: () => new Date("2026-10-02T08:00:00Z"),
}));

import { ensureSystemSchedules } from "./soko-bot-proactive.service";

const bot = {
  id: "bot-1",
  userId: "user-1",
  workspaceId: "ws-1",
  ingestTimezone: "Europe/Berlin",
};

describe("ensureSystemSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleCreateMock.mockResolvedValue({});
  });

  it("gives an existing bot every rhythm it is missing, once", async () => {
    scheduleFindManyMock.mockResolvedValue([
      { systemKey: "standup" },
      { systemKey: "weekly-wrap" },
    ]);
    await ensureSystemSchedules(bot);
    const created = scheduleCreateMock.mock.calls.map(
      (call) => call[0].data.systemKey,
    );
    expect(created).toEqual([
      "meeting-prep",
      "end-of-day",
      "follow-ups",
      "monday-plan",
      "monthly-review",
      "memory-cleanup",
    ]);
  });

  it("creates nothing when every rhythm exists", async () => {
    scheduleFindManyMock.mockResolvedValue(
      SOKO_BOT_SYSTEM_SCHEDULES.map((schedule) => ({
        systemKey: schedule.key,
      })),
    );
    await ensureSystemSchedules(bot);
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it("leaves a personal bot's rhythms on, with its own prompts", async () => {
    scheduleFindManyMock.mockResolvedValue([]);
    await ensureSystemSchedules(bot);
    const first = scheduleCreateMock.mock.calls[0]?.[0].data;
    expect(first).not.toHaveProperty("enabled");
    expect(first.requestedByUserId).toBe("user-1");
    expect(first.prompt).toBe(SOKO_BOT_SYSTEM_SCHEDULES[0]?.prompt);
  });

  it("gives a shared bot its shared rhythms off, asked for by nobody", async () => {
    scheduleFindManyMock.mockResolvedValue([]);
    await ensureSystemSchedules({ ...bot, userId: null });
    const rows = scheduleCreateMock.mock.calls.map((call) => call[0].data);
    expect(rows.map((row) => row.systemKey)).toEqual([
      "standup",
      "weekly-wrap",
      "end-of-day",
      "monday-plan",
      "monthly-review",
      "memory-cleanup",
    ]);
    for (const row of rows) {
      const rhythm = SOKO_BOT_SYSTEM_SCHEDULES.find(
        (schedule) => schedule.key === row.systemKey,
      );
      expect(row.enabled).toBe(false);
      expect(row.requestedByUserId).toBeNull();
      expect(row.prompt).toBe(rhythm?.promptShared);
    }
  });
});
