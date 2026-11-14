/**
 * Calendar run changes against a real PostgreSQL: the scheduler fires a moved
 * run once at its new time, never a skipped one, keeps the cron, and the
 * row lock orders a change against another change and against a claim.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-schedule-run-changes.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";

vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import {
  createSokoBotSchedule,
  updateSokoBotSchedule,
} from "./soko-bot-schedule.service";
import { SokoBotSchedulesSyncService } from "./soko-bot-schedules-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const at = (iso: string) => new Date(iso);

describe.skipIf(!enabled)("Soko Bot schedule run changes", () => {
  let userId: string;
  let workspaceId: string;
  let botId: string;
  let scheduleId: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Monday 2030-01-07, half an hour before the first hourly run.
    vi.setSystemTime(at("2030-01-07T00:30:00.000Z"));
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Schedule owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    workspaceId = (await prisma.workspace.create({ data: { userId } })).id;
    botId = (
      await prisma.sokoBot.create({
        data: { userId, workspaceId, proactiveDailyLimit: 10_000 },
      })
    ).id;
    scheduleId = (
      await createSokoBotSchedule({
        userId,
        workspaceId,
        name: "Hourly check",
        timezone: "UTC",
        cronExpression: "0 * * * *",
        prompt: "Check in.",
      })
    ).id;
    // Each run's turn finishes at once, the way a settled duplicate does.
    vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementation(
      async (input) => {
        const turn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source: "SCHEDULE",
            status: "COMPLETED",
            clientTurnId: input.clientTurnId,
            userMessage: input.message,
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 60 * 60 * 1_000),
          },
        });
        return {
          turnId: turn.id,
          sokoBotId: botId,
          sessionId: "fixture",
          status: "COMPLETED",
          route: "DELEGATE_TASK",
          capabilities: [],
          duplicate: true,
        };
      },
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const change = (run: {
    originalAt: string;
    expectedAt: string | null;
    action: "skip" | "move" | "restore";
    scheduledAt?: string;
  }) => updateSokoBotSchedule({ userId, scheduleId, run });

  /** Runs the scheduler at `iso`, the way the cron tick does. */
  async function tick(iso: string) {
    vi.setSystemTime(at(iso));
    let budget = 3;
    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: () => budget-- > 0,
    });
  }

  const firedAt = async () =>
    (
      await prisma.sokoBotScheduleRun.findMany({
        where: { scheduleId },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      })
    ).map((run) => run.scheduledFor.toISOString());

  it("fires a moved later run once at its new time, never a skipped one, and keeps the cron", async () => {
    await change({
      originalAt: "2030-01-07T02:00:00.000Z",
      expectedAt: "2030-01-07T02:00:00.000Z",
      action: "skip",
    });
    await change({
      originalAt: "2030-01-07T03:00:00.000Z",
      expectedAt: "2030-01-07T03:00:00.000Z",
      action: "move",
      scheduledAt: "2030-01-07T03:30:00.000Z",
    });

    for (const iso of [
      "2030-01-07T01:00:05.000Z",
      "2030-01-07T02:00:05.000Z",
      "2030-01-07T03:00:05.000Z",
      "2030-01-07T03:30:05.000Z",
      "2030-01-07T04:00:05.000Z",
      // A second pass over the same times claims nothing again.
      "2030-01-07T04:00:10.000Z",
    ]) {
      await tick(iso);
    }

    expect(await firedAt()).toEqual([
      "2030-01-07T01:00:00.000Z",
      "2030-01-07T03:30:00.000Z",
      "2030-01-07T04:00:00.000Z",
    ]);
    const schedule = await prisma.sokoBotSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
    });
    expect(schedule.cronExpression).toBe("0 * * * *");
    expect(schedule.nextRunAt).toEqual(at("2030-01-07T05:00:00.000Z"));
  });

  it("lets one of two changes to the same run win and refuses the other with 409", async () => {
    const seen = "2030-01-07T02:00:00.000Z";
    const results = await Promise.allSettled([
      change({ originalAt: seen, expectedAt: seen, action: "skip" }),
      change({
        originalAt: seen,
        expectedAt: seen,
        action: "move",
        scheduledAt: "2030-01-07T02:30:00.000Z",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect(refused?.status === "rejected" && refused.reason).toMatchObject({
      status: 409,
    });
    expect(
      await prisma.sokoBotScheduleRunChange.count({ where: { scheduleId } }),
    ).toBe(1);
  });

  it("keeps a skip made while the scheduler claims the run before it", async () => {
    vi.setSystemTime(at("2030-01-07T01:00:05.000Z"));
    let budget = 1;
    await Promise.all([
      new SokoBotSchedulesSyncService().syncDueSchedules({
        shouldContinue: () => budget-- > 0,
      }),
      change({
        originalAt: "2030-01-07T02:00:00.000Z",
        expectedAt: "2030-01-07T02:00:00.000Z",
        action: "skip",
      }),
    ]);
    // Whichever took the lock first, the claim walks past the skipped run.
    expect(
      (
        await prisma.sokoBotSchedule.findUniqueOrThrow({
          where: { id: scheduleId },
        })
      ).nextRunAt,
    ).toEqual(at("2030-01-07T03:00:00.000Z"));
    await tick("2030-01-07T02:00:05.000Z");
    expect(await firedAt()).toEqual(["2030-01-07T01:00:00.000Z"]);
  });
});
