import { randomUUID } from "node:crypto";
import type { Task, TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TASK_RESTORED_COMMENT } from "@/helpers/task-reopen-instructions";
import prisma from "@/lib/db/prisma";
import { setSeoAuditArchived } from "./seo-audit-archive";
import { archiveTaskRecord, restoreTaskRecord } from "./task-domain-archive";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID();
const teammateId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const actor = { userId: teammateId, organizationId, workspaceId };

function report() {
  return prisma.seoAudit.create({
    data: { workspaceId, createdById: userId, name: "SEO archive fixture" },
  });
}

function task(
  status: TaskStatus = "COMPLETED",
  data: Partial<
    Pick<
      Task,
      "archivedAt" | "visibility" | "workspaceId" | "parentTaskId" | "position"
    >
  > = {},
) {
  return prisma.task.create({
    data: {
      workspaceId,
      ownerId: userId,
      name: "Audit task fixture",
      status,
      ...data,
    },
  });
}

function linkAction(auditId: string, taskId: string) {
  return prisma.projectSeoActionTask.create({
    data: {
      auditId,
      taskId,
      actionId: randomUUID(),
      observationId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
  });
}

function readTask(id: string) {
  return prisma.task.findUniqueOrThrow({ where: { id } });
}

describe.skipIf(!enabled)(
  "SEO report task archiving against PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const id of [userId, teammateId]) {
        await prisma.user.create({
          data: {
            id,
            name: "SEO archive fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "SEO archive fixture",
          slug: organizationId,
          workspace: { create: { id: workspaceId } },
          members: {
            create: [userId, teammateId].map((id) => ({
              userId: id,
              role: "member",
              seatAssignedAt: new Date(),
            })),
          },
        },
      });
      await prisma.workspace.create({
        data: { id: foreignWorkspaceId, userId },
      });
    });

    afterAll(async () => {
      await prisma.task.deleteMany({
        where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } },
      });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, teammateId] } },
      });
      await prisma.$disconnect();
    });

    it("archives only this report's Tasks and restores only the ones still archived by it", async () => {
      const { id } = await report();
      const analysis = await task();
      const action = await task("READY");
      const subtask = await task("DRAFT", {
        parentTaskId: action.id,
        position: 1,
      });
      const manual = await task("DRAFT");
      const earlier = new Date("2025-01-01T00:00:00Z");
      const previouslyArchived = await task("COMPLETED", {
        archivedAt: earlier,
        parentTaskId: action.id,
        position: 2,
      });
      const moved = await task("COMPLETED", {
        workspaceId: foreignWorkspaceId,
      });
      const borrowed = await task();
      const unrelated = await task();
      await prisma.projectSeoAnalysis.create({
        data: {
          auditId: id,
          taskId: analysis.id,
          requestedBy: userId,
          idempotencyKey: randomUUID(),
          requestHash: "test",
          request: {},
          kind: "audit_full",
          status: "completed",
          pageIds: [],
        },
      });
      for (const item of [action, subtask, manual, previouslyArchived, moved])
        await linkAction(id, item.id);
      const otherReport = await report();
      await linkAction(otherReport.id, unrelated.id);
      await linkAction(otherReport.id, previouslyArchived.id);
      await prisma.projectSeoObservation.create({
        data: {
          auditId: id,
          kind: "audit_full",
          source: "seo_coworker",
          sourceKey: randomUUID(),
          sourceTaskId: borrowed.id,
          pageIds: [],
          artifactHash: "test",
          observedAt: new Date(),
          payload: {},
        },
      });

      const followUp = await prisma.notification.create({
        data: {
          userId,
          workspaceId,
          organizationId,
          kind: "TASK",
          referenceId: subtask.id,
          eventId: randomUUID(),
          messageKey: "Notifications.Task.assigned",
          messageParams: "{}",
        },
      });

      await setSeoAuditArchived(actor, id, true);
      const { archivedAt } = await prisma.seoAudit.findUniqueOrThrow({
        where: { id },
      });
      expect(archivedAt).not.toBeNull();
      expect(
        await prisma.notification.findUniqueOrThrow({
          where: { id: followUp.id },
        }),
      ).toMatchObject({ isRead: true });
      for (const item of [analysis, action, subtask, manual]) {
        expect((await readTask(item.id)).archivedAt).toEqual(archivedAt);
      }
      for (const item of [borrowed, moved, unrelated]) {
        expect((await readTask(item.id)).archivedAt).toBeNull();
      }

      await prisma.$transaction(async (tx) => {
        await restoreTaskRecord(
          tx,
          await tx.task.findUniqueOrThrow({ where: { id: manual.id } }),
          { kind: "user", userId },
        );
        await archiveTaskRecord(
          tx,
          await tx.task.findUniqueOrThrow({ where: { id: manual.id } }),
        );
      });
      const later = (await readTask(manual.id)).archivedAt;
      expect(later).not.toEqual(archivedAt);
      await setSeoAuditArchived(actor, id, false);
      expect(await readTask(analysis.id)).toMatchObject({
        archivedAt: null,
        status: "COMPLETED",
      });
      expect(await readTask(action.id)).toMatchObject({
        archivedAt: null,
        status: "DRAFT",
      });
      expect((await readTask(subtask.id)).archivedAt).toBeNull();
      expect((await readTask(previouslyArchived.id)).archivedAt).toEqual(
        earlier,
      );
      expect((await readTask(manual.id)).archivedAt).toEqual(later);
    });

    it.each(["archive", "restore"] as const)(
      "keeps a nested Task of a different report untouched on %s",
      async (operation) => {
        const { id } = await report();
        const other = await report();
        const parent = await task();
        const child = await task("DRAFT", {
          parentTaskId: parent.id,
          position: 1,
        });
        await linkAction(id, parent.id);
        if (operation === "restore") await setSeoAuditArchived(actor, id, true);
        await linkAction(other.id, child.id);

        await expect(
          setSeoAuditArchived(actor, id, operation === "archive"),
        ).rejects.toMatchObject({ status: 409 });
        const { archivedAt } = await prisma.seoAudit.findUniqueOrThrow({
          where: { id },
        });
        if (operation === "archive") expect(archivedAt).toBeNull();
        else expect(archivedAt).not.toBeNull();
        expect((await readTask(parent.id)).archivedAt).toEqual(archivedAt);
        expect((await readTask(child.id)).archivedAt).toEqual(archivedAt);
      },
    );

    it("archives and restores a year of daily checks with their Task history", async () => {
      const { id } = await report();
      const taskIds = Array.from({ length: 365 }, () => randomUUID());
      await prisma.task.createMany({
        data: taskIds.map((taskId) => ({
          id: taskId,
          workspaceId,
          ownerId: userId,
          name: "Historical audit",
          status: "COMPLETED",
        })),
      });
      await prisma.projectSeoAnalysis.createMany({
        data: taskIds.map((taskId) => ({
          auditId: id,
          taskId,
          requestedBy: userId,
          idempotencyKey: taskId,
          requestHash: "test",
          request: {},
          kind: "audit_full",
          status: "completed",
          pageIds: [],
        })),
      });

      await setSeoAuditArchived(actor, id, true);
      const ids = { in: taskIds };
      expect(
        await prisma.task.count({
          where: { id: ids, archivedAt: { not: null } },
        }),
      ).toBe(taskIds.length);
      await setSeoAuditArchived(actor, id, false);
      expect(
        await prisma.task.count({
          where: { id: ids, archivedAt: null, status: "COMPLETED" },
        }),
      ).toBe(taskIds.length);
      expect(
        await prisma.taskEvent.count({
          where: {
            taskId: ids,
            userId: teammateId,
            comment: TASK_RESTORED_COMMENT,
          },
        }),
      ).toBe(taskIds.length);
    }, 60_000);

    it.each(["running", "private"] as const)(
      "rolls back the report and its other Tasks if a linked Task is %s",
      async (reason) => {
        const { id } = await report();
        const allowed = await task();
        await linkAction(id, allowed.id);
        const blocked =
          reason === "running"
            ? await task("RUNNING")
            : await task("DRAFT", { visibility: "PRIVATE" });
        await linkAction(id, blocked.id);
        await expect(
          setSeoAuditArchived(actor, id, true),
        ).rejects.toMatchObject({
          status: reason === "running" ? 422 : 404,
        });
        expect(
          (await prisma.seoAudit.findUniqueOrThrow({ where: { id } }))
            .archivedAt,
        ).toBeNull();
        expect((await readTask(allowed.id)).archivedAt).toBeNull();
        expect((await readTask(blocked.id)).archivedAt).toBeNull();
      },
    );
  },
);
