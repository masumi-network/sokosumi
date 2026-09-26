import { randomUUID } from "node:crypto";

import type { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const value = process.env.LOCAL_RELIABILITY_DATABASE_URL;
  if (!value) throw new Error("Explicit disposable local database required");
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    !["/soko_reliability_verified", "/soko_reliability_integrated"].includes(
      url.pathname,
    )
  ) {
    throw new Error(
      "Only the disposable local reliability database is allowed",
    );
  }
  return { default: createPrismaClient(value) };
});
vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskStatusEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const databaseUrl = process.env.LOCAL_RELIABILITY_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "schedule receipt transactions (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let service: InstanceType<
      typeof import("./soko-bot-runtime.service").SokoBotRuntimeService
    >;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    const sessionId = randomUUID();
    let turnId: string;

    beforeAll(async () => {
      db = (await import("@/lib/db/prisma")).default;
      service = new (
        await import("./soko-bot-runtime.service")
      ).SokoBotRuntimeService();
      await db.user.create({
        data: {
          id: userId,
          name: "Action fixture",
          email: `actions-${userId}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.workspace.create({ data: { id: workspaceId, userId } });
      await db.sokoBot.create({
        data: { id: botId, userId, workspaceId, status: "RUNNING" },
      });
      vi.spyOn(service, "authorize").mockImplementation(async () => ({
        turn: {
          id: turnId,
          userId,
          workspaceId,
          sokoBotId: botId,
          eveSessionId: sessionId,
          versionId: "v16",
          source: "CHAT",
          chainDepth: 0,
        },
        askedByKind: "OWNER",
        classificationConfidence: 1,
        grant: {
          userId,
          workspaceId,
          sokoBotId: botId,
          issuer: "fixture",
          audience: "fixture",
          subject: botId,
          jwtId: randomUUID(),
          sessionId,
          turnId,
          contextSnapshotId: randomUUID(),
          memoryRevisionId: null,
          memoryVersion: 0,
          capabilities: [
            "create_schedule",
            "update_schedule",
            "delete_schedule",
          ],
          issuedAt: 0,
          expiresAt: 9999999999,
        },
      }));
    });
    afterAll(async () => {
      if (!db) return;
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
    });
    async function fixture() {
      const turn = await db.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          userMessage: "Add my instruction",
          capabilityNames: [
            "create_schedule",
            "update_schedule",
            "delete_schedule",
          ],
          deadlineAt: new Date(Date.now() + 600_000),
          leaseExpiresAt: new Date(Date.now() + 600_000),
        },
      });
      turnId = turn.id;
    }

    const scheduleInput = {
      name: "Weekly briefing",
      prompt: "Review work",
      timezone: "UTC",
      cronExpression: "0 9 * * 1",
    };
    it("semantic retry commits one schedule and one applied receipt", async () => {
      await fixture();
      const input = {
        sessionId,
        turnId,
        capability: "create_schedule" as const,
        toolCallId: "create",
        input: scheduleInput,
      };
      await service.executeTool(input);
      await service.executeTool({ ...input, toolCallId: "retry" });
      expect(
        await db.sokoBotSchedule.count({
          where: { sokoBotId: botId, name: scheduleInput.name },
        }),
      ).toBe(1);
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(1);
    });
    it("cancellation prevents schedule updates and applied receipts", async () => {
      await fixture();
      const { createSokoBotSchedule } = await import(
        "./soko-bot-schedule.service"
      );
      const schedule = await createSokoBotSchedule({
        ...scheduleInput,
        userId,
        workspaceId,
      });
      await db.sokoBotTurn.update({
        where: { id: turnId },
        data: { status: "CANCEL_REQUESTED" },
      });
      await expect(
        service.executeTool({
          sessionId,
          turnId,
          capability: "update_schedule",
          toolCallId: "cancelled",
          input: { scheduleId: schedule.id, prompt: "Must not persist" },
        }),
      ).rejects.toThrow("no longer writable");
      expect(
        await db.sokoBotSchedule.findUnique({ where: { id: schedule.id } }),
      ).toMatchObject({ prompt: scheduleInput.prompt });
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(0);
    });
    it("another workspace schedule cannot be changed through its ID", async () => {
      await fixture();
      const other = await db.user.create({
        data: {
          name: "Other",
          emailVerified: true,
          email: `schedule-other-${randomUUID()}@sokosumi.test`,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      try {
        const workspace = await db.workspace.create({
          data: { userId: other.id },
        });
        const bot = await db.sokoBot.create({
          data: { userId: other.id, workspaceId: workspace.id },
        });
        const schedule = await db.sokoBotSchedule.create({
          data: {
            ...scheduleInput,
            userId: other.id,
            workspaceId: workspace.id,
            sokoBotId: bot.id,
            nextRunAt: new Date(),
          },
        });
        await expect(
          service.executeTool({
            sessionId,
            turnId,
            capability: "update_schedule",
            toolCallId: "foreign",
            input: { scheduleId: schedule.id, enabled: false },
          }),
        ).rejects.toThrow("Schedule not found");
        expect(
          await db.sokoBotSchedule.findUnique({ where: { id: schedule.id } }),
        ).toMatchObject({ enabled: true });
      } finally {
        await db.user.delete({ where: { id: other.id } });
      }
    });
  },
);
