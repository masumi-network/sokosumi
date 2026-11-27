/**
 * Calendar run changes against a real PostgreSQL: the scheduler fires a moved
 * run once at its new time, even when it claims late, never a skipped one,
 * keeps the cron, and the row lock orders a change against another change and
 * against a claim. A one-time run can be skipped and put back, two Undos at
 * once never pass the active-schedule cap together, and a spent one stays in
 * the Calendar's history for the retention window.
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
import { readSokoBot } from "@/routes/v1/workspaces/calendar/read-soko-bot";

vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import {
  createSokoBotSchedule,
  MAX_ACTIVE_SOKO_BOT_SCHEDULES,
  purgeSokoBotSchedules,
  SOKO_BOT_SCHEDULE_RETENTION_MS,
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
        network: "mainnet",
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

  const change = (
    run: {
      originalAt: string;
      expectedAt: string | null;
      action: "skip" | "move" | "restore";
      scheduledAt?: string;
    },
    id = scheduleId,
  ) => updateSokoBotSchedule({ userId, scheduleId: id, run });

  const oneTime = async (name: string, runAt: string) =>
    (
      await createSokoBotSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name,
        timezone: "UTC",
        runAt,
        prompt: "Remind me.",
      })
    ).id;

  /** Runs the scheduler at `iso`, the way the cron tick does. */
  async function tick(iso: string) {
    vi.setSystemTime(at(iso));
    let budget = 3;
    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: () => budget-- > 0,
    });
  }

  const firedAt = async (id = scheduleId) =>
    (
      await prisma.sokoBotScheduleRun.findMany({
        where: { scheduleId: id },
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

  it("fires a moved run once when the scheduler claims the run before it late", async () => {
    // 03:00 moved to 01:01; the first tick comes only at 01:01:05.
    await change({
      originalAt: "2030-01-07T03:00:00.000Z",
      expectedAt: "2030-01-07T03:00:00.000Z",
      action: "move",
      scheduledAt: "2030-01-07T01:01:00.000Z",
    });
    for (const iso of [
      "2030-01-07T01:01:05.000Z",
      "2030-01-07T01:01:10.000Z",
      "2030-01-07T02:00:05.000Z",
      "2030-01-07T03:00:05.000Z",
      "2030-01-07T03:00:10.000Z",
    ]) {
      await tick(iso);
    }
    expect(await firedAt()).toEqual([
      "2030-01-07T01:00:00.000Z",
      "2030-01-07T01:01:00.000Z",
      "2030-01-07T02:00:00.000Z",
    ]);
  });

  it("never claims a skipped one-time run, and fires it once after Undo", async () => {
    const skipped = await oneTime(
      "Skipped reminder",
      "2030-01-07T01:30:00.000Z",
    );
    const undone = await oneTime("Undone reminder", "2030-01-07T01:45:00.000Z");
    for (const id of [skipped, undone]) {
      const at =
        id === skipped
          ? "2030-01-07T01:30:00.000Z"
          : "2030-01-07T01:45:00.000Z";
      await change({ originalAt: at, expectedAt: at, action: "skip" }, id);
    }
    await change(
      {
        originalAt: "2030-01-07T01:45:00.000Z",
        expectedAt: null,
        action: "restore",
      },
      undone,
    );
    await tick("2030-01-07T02:00:05.000Z");
    await tick("2030-01-07T02:00:10.000Z");
    expect(await firedAt(skipped)).toEqual([]);
    expect(await firedAt(undone)).toEqual(["2030-01-07T01:45:00.000Z"]);
  });

  it("keeps a done one-time run on the Calendar for the retention window", async () => {
    const reminder = await oneTime(
      "Morning reminder",
      "2030-01-07T00:45:00.000Z",
    );
    await prisma.sokoBotSchedule.update({
      where: { id: scheduleId },
      data: { enabled: false },
    });
    await tick("2030-01-07T00:45:05.000Z");
    expect(
      await prisma.sokoBotScheduleRun.findMany({
        where: { scheduleId: reminder },
        select: { status: true },
      }),
    ).toEqual([{ status: "COMPLETED" }]);

    const calendar = () =>
      readSokoBot({
        workspaceId,
        userId,
        query: {
          from: at("2030-01-07T00:00:00.000Z"),
          to: at("2030-01-08T00:00:00.000Z"),
          cursor: null,
          requestedCursor: null,
          limit: 50,
          scope: "workspace",
        },
        options: {},
      });
    const shown = async () =>
      (await calendar()).items.flatMap((item) =>
        item.kind === "sokoBotRun" && item.scheduleId === reminder
          ? [item.runState]
          : [],
      );

    // Hours later, past the old one-hour cleanup: still there, done.
    const later = new Date(Date.now() + 3 * 60 * 60 * 1_000);
    await purgeSokoBotSchedules(later);
    expect(await shown()).toEqual(["done"]);

    // Just inside the week: still there.
    const weekLater = new Date(Date.now() + SOKO_BOT_SCHEDULE_RETENTION_MS);
    await purgeSokoBotSchedules(new Date(weekLater.getTime() - 60_000));
    expect(await shown()).toEqual(["done"]);

    // Past the week: gone with its run.
    expect(
      (await purgeSokoBotSchedules(new Date(weekLater.getTime() + 60_000)))
        .spentOneTime,
    ).toBe(1);
    expect(await shown()).toEqual([]);
  });

  it("lets only one of two concurrent one-time Undos take the last active slot", async () => {
    // The hourly schedule and eight more are active; A and B are skipped.
    for (let i = 0; i < MAX_ACTIVE_SOKO_BOT_SCHEDULES - 2; i++) {
      await createSokoBotSchedule({
        network: "mainnet",
        userId,
        workspaceId,
        name: `Filler ${i}`,
        timezone: "UTC",
        cronExpression: "0 9 * * *",
        prompt: "Check in.",
      });
    }
    const times = ["2030-01-07T05:00:00.000Z", "2030-01-07T06:00:00.000Z"];
    const ids: string[] = [];
    for (const [i, time] of times.entries()) {
      const id = await oneTime(`Reminder ${i}`, time);
      await change({ originalAt: time, expectedAt: time, action: "skip" }, id);
      ids.push(id);
    }
    const active = () =>
      prisma.sokoBotSchedule.count({
        where: { sokoBotId: botId, enabled: true, systemKey: null },
      });
    expect(await active()).toBe(MAX_ACTIVE_SOKO_BOT_SCHEDULES - 1);

    // Both Undos count the active schedules before either switches its own
    // on: the interleaving where a plain transaction lets both through.
    let counted = 0;
    let release: () => void = () => {};
    const bothCounted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: unknown) => Promise<unknown>,
      options: unknown,
    ) =>
      transaction(
        (tx) =>
          callback(
            new Proxy(tx, {
              get: (target, key) =>
                key === "sokoBotSchedule"
                  ? new Proxy(target.sokoBotSchedule, {
                      get: (model, method) =>
                        method === "count"
                          ? async (args: never) => {
                              const n = await model.count(args);
                              if (++counted === 2) release();
                              if (counted <= 2) {
                                await Promise.race([
                                  bothCounted,
                                  new Promise((r) => setTimeout(r, 2_000)),
                                ]);
                              }
                              return n;
                            }
                          : Reflect.get(model, method),
                    })
                  : Reflect.get(target, key),
            }),
          ),
        options as never,
      )) as never);

    const results = await Promise.allSettled(
      ids.map((id, i) =>
        change(
          {
            originalAt: times[i] as string,
            expectedAt: null,
            action: "restore",
          },
          id,
        ),
      ),
    );
    expect(counted).toBeGreaterThanOrEqual(2);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await active()).toBe(MAX_ACTIVE_SOKO_BOT_SCHEDULES);
  });
});
