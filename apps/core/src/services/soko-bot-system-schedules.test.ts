import { SOKO_BOT_SYSTEM_SCHEDULES } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scheduleFindManyMock, scheduleCreateMock } = vi.hoisted(() => ({
  scheduleFindManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findUnique: vi.fn().mockResolvedValue({ versionId: "v19" }) },
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
});
