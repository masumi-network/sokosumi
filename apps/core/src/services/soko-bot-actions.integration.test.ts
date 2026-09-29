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
    ![
      "/soko_reliability_verified",
      "/soko_reliability_integrated",
      "/soko_reliability_integrated_6e",
    ].includes(url.pathname)
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
  "action receipt transactions (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let service: InstanceType<
      typeof import("./soko-bot-runtime.service").SokoBotRuntimeService
    >;
    let commit: typeof import("@/lib/soko-bot/action-receipts").commitActionReceipt;
    let response: typeof import("@/lib/soko-bot/action-response").buildActionResponse;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    const sessionId = randomUUID();
    let turnId: string;

    beforeAll(async () => {
      db = (await import("@/lib/db/prisma")).default;
      commit = (await import("@/lib/soko-bot/action-receipts"))
        .commitActionReceipt;
      response = (await import("@/lib/soko-bot/action-response"))
        .buildActionResponse;
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
          capabilities: ["reply_to_task", "update_task"],
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
          capabilityNames: ["reply_to_task", "update_task"],
          deadlineAt: new Date(Date.now() + 600_000),
          leaseExpiresAt: new Date(Date.now() + 600_000),
        },
      });
      turnId = turn.id;
      return db.task.create({
        data: {
          name: "Receipt fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "RUNNING",
          assigneeSokoBotId: botId,
        },
      });
    }
    it.each(["reply_to_task", "create_task"])(
      "%s receipts preserve authorized targets except newly created task identities",
      async (capability) => {
        const task = await fixture();
        const originalTarget = randomUUID();
        const intent = await db.sokoBotIntent.create({
          data: {
            sokoBotId: botId,
            workspaceId,
            requesterId: userId,
            originatingTurnId: turnId,
            desiredOutcome: "Test receipt target scope",
            targetIds: [originalTarget],
            allowedActions: [capability],
            acceptanceCriteria: [],
            evidenceIds: [],
            expiresAt: new Date(Date.now() + 600_000),
          },
        });
        await db.sokoBotTurn.update({
          where: { id: turnId },
          data: { intentId: intent.id, intentRevision: 1 },
        });
        await db.sokoBotToolCall.create({
          data: {
            turnId,
            toolCallId: "scope-proof",
            capability,
            inputHash: "scope-proof",
            status: "PENDING",
          },
        });
        await db.$transaction((tx) =>
          commit(tx, {
            turnId,
            toolCallId: "scope-proof",
            actorBotId: botId,
            targetId: task.id,
            result: { id: task.id },
          }),
        );
        const stored = await db.sokoBotIntent.findUniqueOrThrow({
          where: { id: intent.id },
        });
        expect(stored.targetIds).toEqual(
          capability === "create_task"
            ? [originalTarget, task.id]
            : [originalTarget],
        );
        expect(stored.revision).toBe(1);
      },
    );
    it("already-running task still receives a new instruction without a false restart claim", async () => {
      const task = await fixture();
      const input = {
        sessionId,
        turnId,
        capability: "reply_to_task" as const,
        toolCallId: "reply",
        input: {
          taskId: task.id,
          status: "READY",
          comment: "Use the approved scope",
        },
      };
      const result = await service.executeTool(input);
      expect(result).toMatchObject({
        commented: true,
        statusChanged: false,
        status: "RUNNING",
      });
      const receipt = await db.sokoBotToolCall.findUniqueOrThrow({
        where: { turnId_toolCallId: { turnId, toolCallId: "reply" } },
      });
      expect(receipt).toMatchObject({
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        targetId: task.id,
      });
      expect(
        await db.taskEvent.findUnique({
          where: { id: receipt.effectEventId ?? "" },
        }),
      ).toMatchObject({ comment: "Use the approved scope", status: null });
      await service.executeTool(input);
      await service.executeTool({ ...input, toolCallId: "semantic-retry" });
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(1);
      const rendered = await response(
        db,
        turnId,
        "I restarted and completed all work.",
      );
      expect(rendered.answerText).toContain("Added a task comment");
      expect(rendered.answerText).not.toContain("restarted");
      expect(rendered.appliedReceiptIds).toEqual([receipt.id]);
    });
    it("crash before commit rolls back both effect and receipt; replay can apply once", async () => {
      const task = await fixture();
      await db.sokoBotToolCall.create({
        data: {
          turnId,
          toolCallId: "crash",
          capability: "reply_to_task",
          inputHash: "fixture",
        },
      });
      await expect(
        db.$transaction(async (tx) => {
          const event = await tx.taskEvent.create({
            data: { taskId: task.id, sokoBotId: botId, comment: "rolled back" },
          });
          await commit(tx, {
            turnId,
            toolCallId: "crash",
            actorBotId: botId,
            targetId: task.id,
            effectEventId: event.id,
            result: { eventId: event.id },
          });
          throw new Error("simulated crash");
        }),
      ).rejects.toThrow("simulated crash");
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
      expect(
        await db.sokoBotToolCall.findUnique({
          where: { turnId_toolCallId: { turnId, toolCallId: "crash" } },
        }),
      ).toMatchObject({ status: "PENDING", committedAt: null });
    });
    it("parallel semantic retries produce one instruction and one receipt", async () => {
      const task = await fixture();
      const input = {
        sessionId,
        turnId,
        capability: "reply_to_task" as const,
        input: { taskId: task.id, comment: "Exactly once" },
      };
      const attempts = await Promise.allSettled([
        service.executeTool({ ...input, toolCallId: "a" }),
        service.executeTool({ ...input, toolCallId: "b" }),
      ]);
      expect(attempts.some((result) => result.status === "fulfilled")).toBe(
        true,
      );
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(1);
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(1);
    });
    it("cancellation blocks mutation even after tool authorization", async () => {
      const task = await fixture();
      await db.sokoBotTurn.update({
        where: { id: turnId },
        data: {
          status: "CANCEL_REQUESTED",
          cancellationRequestedAt: new Date(),
        },
      });
      await expect(
        service.executeTool({
          sessionId,
          turnId,
          capability: "reply_to_task",
          toolCallId: "cancelled",
          input: { taskId: task.id, comment: "Must not land" },
        }),
      ).rejects.toThrow("no longer writable");
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
      const rendered = await response(db, turnId, "I forwarded it.");
      expect(rendered.answerText).toBe("I could not verify reply_to_task.");
    });
    it("moves the same running task with revision evidence and rejects stale moves", async () => {
      const task = await fixture();
      const project = await db.project.create({
        data: { name: "Target project", workspaceId },
      });
      const result = await service.executeTool({
        sessionId,
        turnId,
        capability: "update_task",
        toolCallId: "move",
        input: {
          taskId: task.id,
          projectId: project.id,
          expectedUpdatedAt: task.updatedAt.toISOString(),
        },
      });
      expect(result).toMatchObject({
        id: task.id,
        before: { projectId: null },
        after: { projectId: project.id },
      });
      expect(await db.task.count({ where: { workspaceId, id: task.id } })).toBe(
        1,
      );
      await expect(
        service.executeTool({
          sessionId,
          turnId,
          capability: "update_task",
          toolCallId: "stale",
          input: {
            taskId: task.id,
            projectId: null,
            expectedUpdatedAt: task.updatedAt.toISOString(),
          },
        }),
      ).rejects.toThrow("Task changed");
    });
    it("cross-workspace task cannot receive a comment", async () => {
      await fixture();
      const otherUser = await db.user.create({
        data: {
          name: "Other fixture",
          email: `other-${randomUUID()}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      try {
        const otherWorkspace = await db.workspace.create({
          data: { userId: otherUser.id },
        });
        const task = await db.task.create({
          data: {
            name: "Private",
            ownerId: otherUser.id,
            creatorUserId: otherUser.id,
            workspaceId: otherWorkspace.id,
          },
        });
        await expect(
          service.executeTool({
            sessionId,
            turnId,
            capability: "reply_to_task",
            toolCallId: "foreign",
            input: { taskId: task.id, comment: "Must not land" },
          }),
        ).rejects.toThrow("Task not found");
        expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(
          0,
        );
      } finally {
        await db.user.delete({ where: { id: otherUser.id } });
      }
    });
  },
);
