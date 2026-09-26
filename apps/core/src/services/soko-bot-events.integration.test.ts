import { randomUUID } from "node:crypto";
import type { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { startTurn, scope } = vi.hoisted(() => ({
  startTurn: vi.fn(),
  scope: { key: crypto.randomUUID(), botId: "" },
}));
vi.mock("@/lib/db/prisma", async () => {
  const value = process.env.LOCAL_RELIABILITY_DATABASE_URL;
  if (!value) throw new Error("Explicit disposable local database required");
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    !["/soko_reliability_verified", "/soko_reliability_integrated"].includes(
      url.pathname,
    )
  )
    throw new Error(
      "Only the disposable local reliability database is allowed",
    );
  const { createPrismaClient } = await import("@sokosumi/database/client");
  // Keep the durable sync key isolated from other suites and browser fixtures.
  const client = createPrismaClient(value).$extends({
    query: {
      syncMetadata: {
        upsert({ args, query }) {
          const key = `${args.where.key}:${scope.key}`;
          return query({
            ...args,
            where: { ...args.where, key },
            create: { ...args.create, key },
          });
        },
        update({ args, query }) {
          // The service passes the persisted scoped key back on update.
          return query(args);
        },
      },
    },
  });
  return { default: client };
});
vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_ENABLED: true, SOKO_BOT_PROACTIVE_PAUSED: false }),
}));
vi.mock("@/helpers/soko-bot-beta", () => ({
  withBetaBotOwner: (where: object) => ({ ...where, id: scope.botId }),
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: { startTurn, reconcileTurn: vi.fn() },
}));

describe.skipIf(!process.env.LOCAL_RELIABILITY_DATABASE_URL)(
  "occurrence pagination (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    beforeAll(async () => {
      scope.botId = botId;
      db = (await import("@/lib/db/prisma")).default;
      await db.user.create({
        data: {
          id: userId,
          name: "Cursor fixture",
          email: `cursor-${userId}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.workspace.create({ data: { id: workspaceId, userId } });
      await db.sokoBot.create({ data: { id: botId, userId, workspaceId } });
    });
    afterAll(async () => {
      if (db) {
        await db.syncMetadata.deleteMany({
          where: { key: `soko-events-v2:${scope.key}` },
        });
        await db.user.deleteMany({ where: { id: userId } });
        await db.$disconnect();
      }
    });
    it("reaches an old delegation past 500 rows and drains twelve same-timestamp occurrences in two bounded batches", async () => {
      const { SokoBotEventsSyncService } = await import(
        "./soko-bot-events-sync.service"
      );
      const turn = await db.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          userId,
          workspaceId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          userMessage: "Fixture",
          deadlineAt: new Date(Date.now() + 60_000),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          capabilityNames: [],
        },
      });
      const history = Array.from({ length: 500 }, () => randomUUID());
      const targetId = randomUUID();
      const delegationPrefix = randomUUID().slice(0, 24);
      const delegationId = `${delegationPrefix}ffffffffffff`;
      await db.task.createMany({
        data: [...history, targetId].map((id) => ({
          id,
          name: "Pagination fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: id === targetId ? "INPUT_REQUIRED" : "COMPLETED",
        })),
      });
      await db.sokoBotDelegation.createMany({
        data: history.map((taskId, index) => ({
          id: `${delegationPrefix}${String(index).padStart(12, "0")}`,
          turnId: turn.id,
          toolCallId: taskId,
          kind: "TASK",
          action: "create_task",
          outcome: "accepted",
          taskId,
          lastSeenStatus: "COMPLETED",
        })),
      });
      const at = new Date("2026-09-26T00:00:00Z");
      await db.syncMetadata.upsert({
        where: { key: "soko-events-v2" },
        create: {
          key: "soko-events-v2",
          createdAt: new Date(at.getTime() - 1000),
          lastSyncedAt: new Date(at.getTime() - 1000),
        },
        update: {},
      });
      await db.sokoBotDelegation.create({
        data: {
          id: delegationId,
          turnId: turn.id,
          toolCallId: "old-target",
          kind: "TASK",
          action: "create_task",
          outcome: "accepted",
          taskId: targetId,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenStatus: "INPUT_REQUIRED",
          lastSeenEventAt: new Date(at.getTime() - 1),
          lastSeenEventId: "before",
        },
      });
      const eventIds = Array.from({ length: 12 }, () => randomUUID()).sort();
      await db.taskEvent.createMany({
        data: eventIds.map((id, index) => ({
          id,
          taskId: targetId,
          createdAt: at,
          status: "INPUT_REQUIRED",
          comment: `Question ${index}`,
        })),
      });
      startTurn.mockResolvedValue({
        turnId: "mock-start",
        status: "COMPLETED",
      });
      const input = {
        abortSignal: new AbortController().signal,
        shouldContinue: () => true,
      };
      const first = await new SokoBotEventsSyncService().syncDelegatedWork(
        input,
      );
      expect(first.scanned).toBe(500);
      expect(startTurn).not.toHaveBeenCalled();
      const second = await new SokoBotEventsSyncService().syncDelegatedWork(
        input,
      );
      expect(second.scanned).toBe(1);
      expect(first.scanned + second.scanned).toBe(501);
      const firstBatch = startTurn.mock.calls[0][0].eventBatch;
      expect(
        firstBatch.map((entry: { eventId: string }) => entry.eventId),
      ).toEqual(eventIds.slice(0, 8));
      // The real startTurn commits this selected cursor with its inbox. Here the
      // boundary is stubbed: prove polling itself never advances unselected work.
      expect(
        await db.sokoBotDelegation.findUnique({ where: { id: delegationId } }),
      ).toMatchObject({ lastSeenEventId: "before" });
      await db.sokoBotDelegation.update({
        where: { id: delegationId },
        data: { lastSeenEventAt: at, lastSeenEventId: eventIds[7] },
      });
      expect(
        (await new SokoBotEventsSyncService().syncDelegatedWork(input)).scanned,
      ).toBe(500);
      expect(
        (await new SokoBotEventsSyncService().syncDelegatedWork(input)).scanned,
      ).toBe(1);
      expect(
        startTurn.mock.calls[1][0].eventBatch.map(
          (entry: { eventId: string }) => entry.eventId,
        ),
      ).toEqual(eventIds.slice(8));
      await db.task.update({
        where: { id: targetId },
        data: { visibility: "PRIVATE", ownerId: userId },
      });
      // A different owner cannot observe a private task through old delegation.
      const other = await db.user.create({
        data: {
          name: "Other fixture",
          email: `cursor-other-${userId}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      try {
        await db.task.update({
          where: { id: targetId },
          data: { ownerId: other.id },
        });
        startTurn.mockClear();
        expect(
          (await new SokoBotEventsSyncService().syncDelegatedWork(input))
            .scanned,
        ).toBe(500);
        expect(
          (await new SokoBotEventsSyncService().syncDelegatedWork(input))
            .scanned,
        ).toBe(1);
        expect(startTurn).not.toHaveBeenCalled();
      } finally {
        await db.task.update({
          where: { id: targetId },
          data: { ownerId: userId },
        });
        await db.user.delete({ where: { id: other.id } });
      }
    });
  },
);
