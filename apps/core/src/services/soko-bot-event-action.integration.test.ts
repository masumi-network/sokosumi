import { randomUUID } from "node:crypto";
import type { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimTaskEventAction } from "./soko-bot-event-action.service";

const databaseUrl = process.env.LOCAL_RELIABILITY_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "event ownership (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const ownerBotId = randomUUID();
    const assignedBotId = randomUUID();
    beforeAll(async () => {
      if (!databaseUrl)
        throw new Error("Explicit disposable local database required");
      const url = new URL(databaseUrl);
      if (
        url.hostname !== "127.0.0.1" ||
        url.port !== "55439" ||
        url.pathname !== "/soko_reliability_verified"
      ) {
        throw new Error(
          "Only the disposable local reliability database is allowed",
        );
      }
      const { createPrismaClient } = await import("@sokosumi/database/client");
      db = createPrismaClient(databaseUrl);
      await db.user.create({
        data: {
          id: userId,
          name: "Ownership fixture",
          email: `ownership-${userId}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.workspace.create({ data: { id: workspaceId, userId } });
      for (const id of [ownerBotId, assignedBotId]) {
        // Each bot belongs to a distinct user; both may observe the shared task.
        const botUserId = id === ownerBotId ? userId : randomUUID();
        if (botUserId !== userId)
          await db.user.create({
            data: {
              id: botUserId,
              name: "Assigned fixture",
              email: `assigned-${botUserId}@sokosumi.test`,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        await db.sokoBot.create({
          data: { id, userId: botUserId, workspaceId },
        });
      }
    });
    afterAll(async () => {
      if (!db) return;
      const assigned = await db.sokoBot.findUnique({
        where: { id: assignedBotId },
      });
      await db.user.deleteMany({
        where: { id: { in: [userId, ...(assigned ? [assigned.userId] : [])] } },
      });
      await db.$disconnect();
    });
    async function eventTurn(botId: string, taskId: string, eventId: string) {
      const turn = await db.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          userId,
          workspaceId,
          source: "EVENT",
          status: "RUNNING",
          clientTurnId: randomUUID(),
          userMessage: "Handle task event",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 600_000),
          leaseExpiresAt: new Date(Date.now() + 600_000),
        },
      });
      await db.sokoBotEventInbox.create({
        data: {
          botId,
          turnId: turn.id,
          entityId: taskId,
          eventId,
          purpose: "TASK_EVENT",
          designatedHandlerBotId: ownerBotId,
        },
      });
      return {
        turnId: turn.id,
        sokoBotId: botId,
        workspaceId,
        source: "EVENT",
      };
    }
    it("retains claim evidence until its task or turn lifecycle ends", async () => {
      const task = await db.task.create({
        data: {
          name: "Lifecycle fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "DRAFT",
        },
      });
      const event = await db.taskEvent.create({
        data: { taskId: task.id, status: "DRAFT" },
      });
      const actor = await eventTurn(ownerBotId, task.id, event.id);
      const receipt = await db.sokoBotToolCall.create({
        data: {
          turnId: actor.turnId,
          toolCallId: randomUUID(),
          capability: "update_task",
          inputHash: "lifecycle",
          status: "COMPLETED",
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
        },
      });
      await db.sokoBotTaskActionClaim.create({
        data: {
          taskId: task.id,
          triggeringEventId: event.id,
          actionKind: "update_task",
          handlerBotId: ownerBotId,
          turnId: actor.turnId,
          receiptId: receipt.id,
        },
      });
      await expect(
        db.sokoBotToolCall.delete({ where: { id: receipt.id } }),
      ).rejects.toMatchObject({ code: "P2003" });
      expect(
        await db.sokoBotTaskActionClaim.count({
          where: { turnId: actor.turnId },
        }),
      ).toBe(1);
      await db.task.delete({ where: { id: task.id } });
      expect(
        await db.sokoBotTaskActionClaim.count({
          where: { turnId: actor.turnId },
        }),
      ).toBe(0);
      expect(
        await db.sokoBotToolCall.findUnique({ where: { id: receipt.id } }),
      ).not.toBeNull();
      // Polymorphic event identity remains durable for this turn even after task deletion.
      expect(
        await db.sokoBotEventInbox.count({ where: { turnId: actor.turnId } }),
      ).toBe(1);
      await db.sokoBotTurn.delete({ where: { id: actor.turnId } });
      expect(
        await db.sokoBotEventInbox.count({ where: { turnId: actor.turnId } }),
      ).toBe(0);
      expect(
        await db.sokoBotToolCall.findUnique({ where: { id: receipt.id } }),
      ).toBeNull();
      await expect(
        db.sokoBotEventInbox.create({
          data: {
            botId: ownerBotId,
            turnId: actor.turnId,
            eventId: event.id,
            entityId: task.id,
            purpose: "TASK_EVENT",
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("cascades claims and referenced receipts together when a turn is deleted", async () => {
      const task = await db.task.create({
        data: {
          name: "Turn lifecycle fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "DRAFT",
        },
      });
      const event = await db.taskEvent.create({
        data: { taskId: task.id, status: "DRAFT" },
      });
      const actor = await eventTurn(ownerBotId, task.id, event.id);
      const receipt = await db.sokoBotToolCall.create({
        data: {
          turnId: actor.turnId,
          toolCallId: randomUUID(),
          capability: "update_task",
          inputHash: "lifecycle",
          status: "COMPLETED",
        },
      });
      await db.sokoBotTaskActionClaim.create({
        data: {
          taskId: task.id,
          triggeringEventId: event.id,
          actionKind: "update_task",
          handlerBotId: ownerBotId,
          turnId: actor.turnId,
          receiptId: receipt.id,
        },
      });
      await db.sokoBotTurn.delete({ where: { id: actor.turnId } });
      expect(
        await db.sokoBotTaskActionClaim.count({
          where: { turnId: actor.turnId },
        }),
      ).toBe(0);
      expect(
        await db.sokoBotEventInbox.count({ where: { turnId: actor.turnId } }),
      ).toBe(0);
      expect(
        await db.sokoBotToolCall.findUnique({ where: { id: receipt.id } }),
      ).toBeNull();
    });

    it("assigned bot alone owns the action, while both bots retain their event notification", async () => {
      const task = await db.task.create({
        data: {
          name: "Shared fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "INPUT_REQUIRED",
          assigneeSokoBotId: assignedBotId,
        },
      });
      const event = await db.taskEvent.create({
        data: {
          taskId: task.id,
          status: "INPUT_REQUIRED",
          comment: "Need decision",
        },
      });
      const owner = await eventTurn(ownerBotId, task.id, event.id);
      const assigned = await eventTurn(assignedBotId, task.id, event.id);
      const results = await Promise.all(
        [owner, assigned].map((actor) =>
          db.$transaction(
            (tx) => claimTaskEventAction(tx, actor, task.id, "reply_to_task"),
            { isolationLevel: "Serializable" },
          ),
        ),
      );
      expect(results.map((result) => result.allowed)).toEqual([false, true]);
      expect(
        await db.sokoBotEventInbox.count({ where: { eventId: event.id } }),
      ).toBe(2);
      expect(
        await db.sokoBotTaskActionClaim.count({ where: { taskId: task.id } }),
      ).toBe(1);
      await expect(
        db.sokoBotEventInbox.create({
          data: {
            botId: assignedBotId,
            turnId: assigned.turnId,
            entityId: task.id,
            eventId: event.id,
            purpose: "TASK_EVENT",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      const foreign = { ...assigned, workspaceId: randomUUID() };
      expect(
        await db.$transaction((tx) =>
          claimTaskEventAction(tx, foreign, task.id, "update_task"),
        ),
      ).toEqual({ allowed: false, claimId: null });
    });
    it("rejects a delayed event turn after a newer human occurrence", async () => {
      const task = await db.task.create({
        data: {
          name: "Stale fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "INPUT_REQUIRED",
          assigneeSokoBotId: assignedBotId,
        },
      });
      const old = await db.taskEvent.create({
        data: {
          taskId: task.id,
          status: "INPUT_REQUIRED",
          createdAt: new Date("2026-09-25T00:00:00Z"),
        },
      });
      const actor = await eventTurn(assignedBotId, task.id, old.id);
      await db.taskEvent.create({
        data: {
          taskId: task.id,
          status: "CANCELED",
          userId,
          comment: "Do not proceed",
        },
      });
      expect(
        await db.$transaction(
          (tx) => claimTaskEventAction(tx, actor, task.id, "update_task"),
          { isolationLevel: "Serializable" },
        ),
      ).toEqual({ allowed: false, claimId: null });
      expect(
        await db.sokoBotTaskActionClaim.count({ where: { taskId: task.id } }),
      ).toBe(0);
    });
    it("rolls ownership back with an aborted effect transaction", async () => {
      const task = await db.task.create({
        data: {
          name: "Rollback fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "INPUT_REQUIRED",
          assigneeSokoBotId: assignedBotId,
        },
      });
      const event = await db.taskEvent.create({
        data: { taskId: task.id, status: "INPUT_REQUIRED" },
      });
      const actor = await eventTurn(assignedBotId, task.id, event.id);
      await expect(
        db.$transaction(async (tx) => {
          expect(
            (await claimTaskEventAction(tx, actor, task.id, "update_task"))
              .allowed,
          ).toBe(true);
          await tx.task.update({
            where: { id: task.id },
            data: { status: "READY" },
          });
          throw new Error("fixture crash");
        }),
      ).rejects.toThrow("fixture crash");
      expect(
        await db.sokoBotTaskActionClaim.count({ where: { taskId: task.id } }),
      ).toBe(0);
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({ status: "INPUT_REQUIRED" });
    });
  },
);
