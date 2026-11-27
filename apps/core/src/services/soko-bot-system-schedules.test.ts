import {
  CMO_SOKO_BOT_VERSION_ID,
  SOKO_BOT_CMO_RHYTHMS,
  SOKO_BOT_SYSTEM_SCHEDULES,
  sokoBotSystemSchedulePrompt,
} from "@sokosumi/soko-bot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";

const { scheduleFindManyMock, scheduleCreateMock } = vi.hoisted(() => ({
  scheduleFindManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBot: { findUnique: vi.fn().mockResolvedValue({ versionId: "v19" }) },
    sokoBotSchedule: {
      findMany: scheduleFindManyMock,
      create: scheduleCreateMock,
    },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback(client),
  };
  return { default: client };
});
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
      "dreaming",
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
    const standup = SOKO_BOT_SYSTEM_SCHEDULES[0];
    expect(standup && first.prompt).toBe(
      standup && sokoBotSystemSchedulePrompt(standup, false),
    );
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
      "dreaming",
    ]);
    for (const row of rows) {
      const rhythm = SOKO_BOT_SYSTEM_SCHEDULES.find(
        (schedule) => schedule.key === row.systemKey,
      );
      expect(row.enabled).toBe(false);
      expect(row.requestedByUserId).toBeNull();
      expect(row.prompt).toBe(
        rhythm && sokoBotSystemSchedulePrompt(rhythm, true),
      );
    }
  });

  it("gives a shared Cuso his rhythms on, run as the member who hired him", async () => {
    scheduleFindManyMock.mockResolvedValue([]);
    await ensureSystemSchedules({
      ...bot,
      userId: null,
      createdByUserId: "hirer-1",
      versionId: CMO_SOKO_BOT_VERSION_ID,
    });
    const rows = scheduleCreateMock.mock.calls.map((call) => call[0].data);
    expect(rows.map((row) => row.systemKey)).toEqual(
      SOKO_BOT_CMO_RHYTHMS.map((schedule) => schedule.key),
    );
    for (const row of rows) {
      expect(row).not.toHaveProperty("enabled");
      expect(row.requestedByUserId).toBe("hirer-1");
      expect(row.prompt).toBe(
        SOKO_BOT_CMO_RHYTHMS.find((schedule) => schedule.key === row.systemKey)
          ?.prompt,
      );
    }
  });

  describe("when the insert deadlocks", () => {
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "P2034",
    });
    const allButDreaming = SOKO_BOT_SYSTEM_SCHEDULES.filter(
      (schedule) => schedule.key !== "dreaming",
    ).map((schedule) => ({ systemKey: schedule.key }));

    beforeEach(() => {
      vi.useFakeTimers();
      scheduleFindManyMock.mockResolvedValue(allButDreaming);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries it and logs nothing once it lands", async () => {
      scheduleCreateMock.mockRejectedValueOnce(deadlock);
      const ensured = ensureSystemSchedules(bot);
      await vi.runAllTimersAsync();
      await ensured;
      expect(scheduleCreateMock).toHaveBeenCalledTimes(2);
    });

    it("warns once its retries are used up", async () => {
      scheduleCreateMock.mockRejectedValue(deadlock);
      const entries = expectCoreLog(
        "warn",
        "A Soko Bot built-in rhythm was not created",
      );
      const ensured = ensureSystemSchedules(bot);
      await vi.runAllTimersAsync();
      await ensured;
      expect(scheduleCreateMock.mock.calls.length).toBeGreaterThan(2);
      expect(entries[0]?.why).toBe(
        "Creating the schedule failed, or kept deadlocking with other writes after its retries",
      );
    });

    it("stays quiet when another tick created the rhythm", async () => {
      scheduleCreateMock.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      await ensureSystemSchedules(bot);
      expect(scheduleCreateMock).toHaveBeenCalledTimes(1);
    });
  });
});
