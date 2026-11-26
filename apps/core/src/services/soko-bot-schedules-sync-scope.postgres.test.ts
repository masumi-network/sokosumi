/**
 * A schedule sync scoped to one schedule (the owner benchmark fires its own
 * schedule this way) claims only that schedule's run, never another
 * schedule's due run or pending recovery, and reports the run it claimed.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-schedules-sync-scope.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";

vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { SokoBotSchedulesSyncService } from "./soko-bot-schedules-sync.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)(
  "Soko Bot schedule sync scoped to one schedule",
  () => {
    let userId: string;
    let workspaceId: string;
    let botId: string;

    const schedule = (name: string) =>
      prisma.sokoBotSchedule.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requestedByUserId: userId,
          name,
          timezone: "UTC",
          cronExpression: "0 * * * *",
          prompt: `${name}.`,
          nextRunAt: new Date(Date.now() - 60 * 60_000),
        },
        select: { id: true, nextRunAt: true },
      });

    beforeEach(async () => {
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
              deadlineAt: new Date(Date.now() + 60 * 60_000),
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
      await prisma.sokoBotSchedule.deleteMany({ where: { sokoBotId: botId } });
      await prisma.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
      await prisma.sokoBot.deleteMany({ where: { id: botId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("claims only the named schedule's run, and says which", async () => {
      const fixture = await schedule("Fixture");
      // Another schedule of the same bot: due, and with a pending recovery the
      // unscoped sync would take first.
      const control = await schedule("Control");
      const recovery = await prisma.sokoBotScheduleRun.create({
        data: {
          scheduleId: control.id,
          scheduledFor: new Date(Date.now() - 2 * 60 * 60_000),
          status: "PENDING",
        },
      });

      const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
        scheduleId: fixture.id,
        shouldContinue: () => true,
      });

      expect(result.claimed).toBe(1);
      const [runId] = result.runIds;
      const run = await prisma.sokoBotScheduleRun.findUniqueOrThrow({
        where: { id: runId },
      });
      expect(run.scheduleId).toBe(fixture.id);
      expect(run.turnId).not.toBeNull();
      expect(
        await prisma.sokoBotScheduleRun.findUniqueOrThrow({
          where: { id: recovery.id },
          select: { status: true, attempt: true },
        }),
      ).toEqual({ status: "PENDING", attempt: 0 });
      expect(
        (
          await prisma.sokoBotSchedule.findUniqueOrThrow({
            where: { id: control.id },
          })
        ).nextRunAt,
      ).toEqual(control.nextRunAt);
      expect(
        await prisma.sokoBotScheduleRun.count({
          where: { scheduleId: control.id },
        }),
      ).toBe(1);
    });
  },
);
