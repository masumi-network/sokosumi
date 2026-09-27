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
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return {
    ...original,
    getEnv: () => ({ ...original.getEnv(), SOKO_BOT_ENABLED: true }),
  };
});

const databaseUrl = process.env.LOCAL_RELIABILITY_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "archive receipt transactions (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let service: InstanceType<
      typeof import("./soko-bot-runtime.service").SokoBotRuntimeService
    >;
    let response: typeof import("@/lib/soko-bot/action-response").buildActionResponse;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    const sessionId = randomUUID();
    let turnId: string;

    beforeAll(async () => {
      db = (await import("@/lib/db/prisma")).default;
      response = (await import("@/lib/soko-bot/action-response"))
        .buildActionResponse;
      service = new (
        await import("./soko-bot-runtime.service")
      ).SokoBotRuntimeService();
      await db.user.create({
        data: {
          id: userId,
          name: "Action fixture",
          email: `archive-${userId}@sokosumi.test`,
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
          capabilities: ["archive_task", "get_task_status"],
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
          userMessage: "Archive the selected draft",
          capabilityNames: ["archive_task"],
          deadlineAt: new Date(Date.now() + 600_000),
          leaseExpiresAt: new Date(Date.now() + 600_000),
        },
      });
      turnId = turn.id;
      const task = await db.task.create({
        data: {
          name: "Receipt fixture",
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          status: "DRAFT",
          assigneeSokoBotId: botId,
        },
      });
      await db.sokoBotTurn.update({
        where: { id: turnId },
        data: { userMessage: `Archive task ${task.id}` },
      });
      return task;
    }

    function archive(
      task: { id: string; updatedAt: Date },
      toolCallId = "archive",
    ) {
      return service.executeTool({
        sessionId,
        turnId,
        capability: "archive_task",
        toolCallId,
        input: {
          taskId: task.id,
          expectedUpdatedAt: task.updatedAt.toISOString(),
        },
      });
    }

    it.each([true, false])(
      "real authorization enforces persisted archive grant=%s",
      async (granted) => {
        const task = await fixture();
        await db.sokoBotTurn.update({
          where: { id: turnId },
          data: {
            eveSessionId: sessionId,
            versionId: "v16",
            capabilityNames: granted ? ["archive_task"] : ["get_task_status"],
          },
        });
        await db.sokoBotContextSnapshot.create({
          data: {
            turnId,
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: randomUUID(),
            packet: {
              memory: { version: 0 },
              trigger: { askedBy: { kind: "OWNER" } },
            },
            byteSize: 1,
            tokenEstimate: 1,
            counts: {},
            omissions: {},
          },
        });
        // A fresh instance has no authorize spy: DB grants, active lease,
        // owner workspace membership and context binding all run normally.
        const realService = new (
          await import("./soko-bot-runtime.service")
        ).SokoBotRuntimeService();
        const attempt = realService.executeTool({
          sessionId,
          turnId,
          capability: "archive_task",
          toolCallId: "real-grant",
          input: {
            taskId: task.id,
            expectedUpdatedAt: task.updatedAt.toISOString(),
          },
        });
        if (granted) {
          await expect(attempt).resolves.toMatchObject({ id: task.id });
          expect(
            (await db.task.findUniqueOrThrow({ where: { id: task.id } }))
              .archivedAt,
          ).not.toBeNull();
        } else {
          await expect(attempt).rejects.toThrow(
            "Capability is not granted for this turn",
          );
          expect(
            (await db.task.findUniqueOrThrow({ where: { id: task.id } }))
              .archivedAt,
          ).toBeNull();
          expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(
            0,
          );
        }
      },
    );

    it("archives the same draft, retaining history and one transactional receipt/outbox", async () => {
      const task = await fixture();
      const previous = await db.taskEvent.create({
        data: { taskId: task.id, userId, comment: "Owner's original scope" },
      });
      await archive(task);
      const stored = await db.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(stored).toMatchObject({
        id: task.id,
        name: task.name,
        status: "DRAFT",
        archivedAt: expect.any(Date),
      });
      expect(
        await db.task.findFirst({ where: { id: task.id, archivedAt: null } }),
      ).toBeNull();
      expect(
        await db.taskEvent.findUnique({ where: { id: previous.id } }),
      ).toMatchObject({ comment: "Owner's original scope" });
      const receipt = await db.sokoBotToolCall.findUniqueOrThrow({
        where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
      });
      expect(receipt).toMatchObject({
        capability: "archive_task",
        targetId: task.id,
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        status: "COMPLETED",
      });
      expect(
        await db.taskEvent.findUnique({
          where: { id: receipt.effectEventId ?? "" },
        }),
      ).toMatchObject({
        taskId: task.id,
        comment: "Task archived",
        sokoBotId: botId,
      });
      expect(
        await db.sokoBotEffectOutbox.findUnique({
          where: {
            receiptId_purpose: { receiptId: receipt.id, purpose: "TASK_EVENT" },
          },
        }),
      ).toMatchObject({ status: "PENDING" });
      const rendered = await response(
        db,
        turnId,
        "I permanently deleted your task.",
      );
      expect(rendered.answerText).toContain("Archived task");
      expect(rendered.answerText).not.toContain("deleted");
      expect(rendered.appliedReceiptIds).toEqual([receipt.id]);
    });

    it("a crash before receipt commit rolls back archival and its history event", async () => {
      const task = await fixture();
      const domain = await import("./task-domain.service");
      const original = domain.updateTaskForActor;
      const crash = vi
        .spyOn(domain, "updateTaskForActor")
        .mockImplementationOnce(async (...args) => {
          await original(...args);
          throw new Error("fixture crash before receipt commit");
        });
      try {
        await expect(archive(task)).rejects.toThrow(
          "fixture crash before receipt commit",
        );
      } finally {
        crash.mockRestore();
      }
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({ archivedAt: null });
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
      const receipt = await db.sokoBotToolCall.findUniqueOrThrow({
        where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
      });
      expect(receipt).toMatchObject({
        status: "FAILED",
        disposition: "REJECTED",
        committedAt: null,
      });
      expect(
        await db.sokoBotEffectOutbox.count({
          where: { receiptId: receipt.id },
        }),
      ).toBe(0);
    });

    it("same-call and semantic retries preserve archivedAt, history, and target", async () => {
      const task = await fixture();
      await archive(task);
      const original = await db.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      await archive(task);
      await archive(task, "semantic-retry");
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({
        archivedAt: original.archivedAt,
        updatedAt: original.updatedAt,
      });
      expect(
        await db.taskEvent.count({
          where: { taskId: task.id, comment: "Task archived" },
        }),
      ).toBe(1);
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(1);
      expect(await db.task.count({ where: { id: task.id } })).toBe(1);
    });

    it.each([false, true])(
      "retries a rolled-back local failure with retained legacy key=%s",
      async (retainedKey) => {
        const task = await fixture();
        const domain = await import("./task-domain.service");
        const failure = vi
          .spyOn(domain, "updateTaskForActor")
          .mockRejectedValueOnce(new Error("transient local failure"));
        await expect(archive(task)).rejects.toThrow("transient local failure");
        failure.mockRestore();
        const rejected = await db.sokoBotToolCall.findUniqueOrThrow({
          where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
        });
        expect(rejected).toMatchObject({
          status: "FAILED",
          disposition: "REJECTED",
          verification: "NONE",
          committedAt: null,
        });
        if (retainedKey) {
          const { actionOperationKey } = await import(
            "@/lib/soko-bot/action-receipts"
          );
          await db.sokoBotToolCall.update({
            where: { id: rejected.id },
            data: {
              operationKey: actionOperationKey({
                workspaceId,
                principalId: userId,
                intentRevision: turnId,
                capability: "archive_task",
                inputHash: rejected.inputHash,
              }),
            },
          });
        }
        await archive(task);
        expect(
          await db.taskEvent.count({
            where: { taskId: task.id, comment: "Task archived" },
          }),
        ).toBe(1);
        expect(
          await db.sokoBotToolCall.findUnique({
            where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
          }),
        ).toMatchObject({ disposition: "APPLIED" });
      },
    );

    it("reports an existing archive as satisfied without changing its timestamp or status", async () => {
      const task = await fixture();
      const archivedAt = new Date();
      const archived = await db.task.update({
        where: { id: task.id },
        data: { archivedAt },
      });
      await expect(
        service.executeTool({
          sessionId,
          turnId,
          capability: "get_task_status",
          toolCallId: "read-archived",
          input: { taskId: task.id },
        }),
      ).resolves.toMatchObject({
        id: task.id,
        archivedAt,
        updatedAt: archived.updatedAt,
      });
      await archive(archived);
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({ archivedAt, status: "DRAFT" });
      expect(
        await db.sokoBotToolCall.findUnique({
          where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
        }),
      ).toMatchObject({
        disposition: "ALREADY_SATISFIED",
        effectEventId: expect.any(String),
      });
      expect((await response(db, turnId, "deleted")).answerText).toContain(
        "Already satisfied",
      );
    });

    it.each([
      "Archive that",
      "Archive task 10000000-0000-4000-8000-000000000099",
    ])(
      "requires an unambiguous owner-selected target: %s",
      async (userMessage) => {
        const task = await fixture();
        await db.sokoBotTurn.update({
          where: { id: turnId },
          data: { userMessage },
        });
        await expect(archive(task)).rejects.toThrow(
          "one explicitly identified task",
        );
        expect(
          await db.task.findUnique({ where: { id: task.id } }),
        ).toMatchObject({ archivedAt: null });
      },
    );

    it.each(["restored", "missing-history"] as const)(
      "does not replay or claim archival when evidence is %s",
      async (change) => {
        const task = await fixture();
        await archive(task);
        const receipt = await db.sokoBotToolCall.findUniqueOrThrow({
          where: { turnId_toolCallId: { turnId, toolCallId: "archive" } },
        });
        if (change === "restored") {
          await db.task.update({
            where: { id: task.id },
            data: { archivedAt: null },
          });
        } else {
          await db.taskEvent.delete({
            where: { id: receipt.effectEventId ?? "" },
          });
        }
        await expect(archive(task)).rejects.toThrow(
          "Archived task history could not be verified",
        );
        const rendered = await response(
          db,
          turnId,
          "Archived task successfully.",
        );
        expect(rendered.appliedReceiptIds).toEqual([]);
        expect(rendered.answerText).not.toContain("Archived task successfully");
        expect(rendered.answerText).toContain("could not verify archive_task");
        expect(await db.task.count({ where: { id: task.id } })).toBe(1);
      },
    );

    it.each([
      "RUNNING",
      "INPUT_REQUIRED",
      "APPROVAL_REQUIRED",
      "AWAITING_EXTERNAL",
    ] as const)(
      "rejects disallowed state %s without success evidence",
      async (status) => {
        const task = await fixture();
        const current = await db.task.update({
          where: { id: task.id },
          data: { status },
        });
        await expect(archive(current)).rejects.toThrow(
          "Tasks can only be archived",
        );
        expect(
          await db.task.findUnique({ where: { id: task.id } }),
        ).toMatchObject({ archivedAt: null, status });
        expect(
          await db.sokoBotToolCall.count({
            where: { turnId, disposition: "APPLIED" },
          }),
        ).toBe(0);
        expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(
          0,
        );
      },
    );

    it.each(["DRAFT", "QUEUED"] as const)(
      "refuses a future Run at on a %s task without canceling it",
      async (status) => {
        const task = await fixture();
        const runAt = new Date(Date.now() + 3600000);
        const current = await db.task.update({
          where: { id: task.id },
          data: { runAt, status },
        });
        await expect(archive(current)).rejects.toThrow(
          "Remove the future Run at",
        );
        expect(
          await db.task.findUnique({ where: { id: task.id } }),
        ).toMatchObject({
          archivedAt: null,
          runAt,
          status,
        });
        expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(
          0,
        );
      },
    );

    it("archives a generated task without changing its active recurring parent", async () => {
      const task = await fixture();
      const schedule = await db.taskSchedule.create({
        data: {
          workspaceId,
          ownerId: userId,
          creatorUserId: userId,
          name: "Synthetic recurring parent",
          expr: "0 9 * * *",
          timezone: "Europe/Berlin",
          anchorAt: new Date(),
          ruleEffectiveFrom: new Date(),
          epochId: randomUUID(),
          nextRunAt: new Date(Date.now() + 3600000),
          releasedCount: 1,
        },
      });
      const current = await db.task.update({
        where: { id: task.id },
        data: { scheduleId: schedule.id, status: "READY" },
      });
      await archive(current);
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({
        archivedAt: expect.any(Date),
        scheduleId: schedule.id,
        status: "READY",
      });
      expect(
        await db.taskSchedule.findUnique({ where: { id: schedule.id } }),
      ).toEqual(schedule);
      expect(
        await db.taskEvent.count({
          where: { taskId: task.id, comment: "Task archived" },
        }),
      ).toBe(1);
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(1);
    });

    it("stale revision cannot archive a task after the owner's edit", async () => {
      const task = await fixture();
      await db.task.update({
        where: { id: task.id },
        data: {
          name: "Changed by owner",
          updatedAt: new Date(task.updatedAt.getTime() + 1000),
        },
      });
      await expect(archive(task)).rejects.toThrow("Task changed");
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({ name: "Changed by owner", archivedAt: null });
      expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(0);
    });

    it("cancellation after authorization blocks archival", async () => {
      const task = await fixture();
      await db.sokoBotTurn.update({
        where: { id: turnId },
        data: {
          status: "CANCEL_REQUESTED",
          cancellationRequestedAt: new Date(),
        },
      });
      await expect(archive(task)).rejects.toThrow("no longer writable");
      expect(
        await db.task.findUnique({ where: { id: task.id } }),
      ).toMatchObject({ archivedAt: null });
    });

    it.each(["owner", "workspace"] as const)(
      "rejects another %s's task",
      async (scope) => {
        await fixture();
        const other = await db.user.create({
          data: {
            name: "Other archive fixture",
            email: `other-archive-${randomUUID()}@sokosumi.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        try {
          const otherWorkspace = await db.workspace.create({
            data: { userId: other.id },
          });
          const task = await db.task.create({
            data: {
              name: "Foreign scope",
              ownerId: scope === "owner" ? other.id : userId,
              creatorUserId: other.id,
              workspaceId: scope === "owner" ? workspaceId : otherWorkspace.id,
              status: "DRAFT",
            },
          });
          await db.sokoBotTurn.update({
            where: { id: turnId },
            data: { userMessage: `Archive task ${task.id}` },
          });
          await expect(archive(task)).rejects.toThrow("Task not found");
          expect(
            await db.task.findUnique({ where: { id: task.id } }),
          ).toMatchObject({ archivedAt: null });
          expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(
            0,
          );
        } finally {
          await db.task.deleteMany({ where: { creatorUserId: other.id } });
          await db.user.delete({ where: { id: other.id } });
        }
      },
    );

    it("concurrent semantic calls archive once", async () => {
      const task = await fixture();
      const attempts = await Promise.allSettled([
        archive(task, "a"),
        archive(task, "b"),
      ]);
      expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(
        true,
      );
      expect(
        await db.taskEvent.count({
          where: { taskId: task.id, comment: "Task archived" },
        }),
      ).toBe(1);
      expect(
        await db.sokoBotToolCall.count({
          where: { turnId, disposition: "APPLIED" },
        }),
      ).toBe(1);
    });

    it("archive and revision-guarded human edit cannot both commit", async () => {
      const task = await fixture();
      const [attempt, edit] = await Promise.allSettled([
        archive(task),
        db.task.updateMany({
          where: { id: task.id, archivedAt: null, updatedAt: task.updatedAt },
          data: {
            name: "Concurrent owner edit",
            updatedAt: new Date(task.updatedAt.getTime() + 1000),
          },
        }),
      ]);
      const current = await db.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      if (attempt.status === "fulfilled") {
        expect(current.archivedAt).not.toBeNull();
        expect(current.name).toBe(task.name);
        expect(edit).toMatchObject({
          status: "fulfilled",
          value: { count: 0 },
        });
      } else {
        expect(current).toMatchObject({
          archivedAt: null,
          name: "Concurrent owner edit",
        });
        expect(
          await db.sokoBotToolCall.count({
            where: { turnId, disposition: "APPLIED" },
          }),
        ).toBe(0);
      }
    });
  },
);
