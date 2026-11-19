import type { Prisma, Task } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  buildTaskWriteAccessWhere,
  requireRightOnWorkWithoutOwner,
} from "@/helpers/access-control";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import type { SeoWorkspaceActor } from "./project-seo-store";
import {
  archiveTaskRecord,
  restoreTaskRecord,
  setTerminalRootTasksArchived,
} from "./task-domain-archive";

type ChangedTask = Pick<Task, "id" | "ownerId" | "assigneeUserId">;

async function linkedTaskIds(tx: Prisma.TransactionClient, auditId: string) {
  // Analyses include scheduled checks. An imported observation can cite someone
  // else's Task as evidence and does not transfer its lifecycle to this report.
  const { analyses, actionTasks } = await tx.seoAudit.findUniqueOrThrow({
    where: { id: auditId },
    select: {
      analyses: { where: { projectId: null }, select: { taskId: true } },
      actionTasks: { where: { projectId: null }, select: { taskId: true } },
    },
  });
  return [
    ...new Set(
      [...analyses, ...actionTasks].flatMap(({ taskId }) => taskId ?? []),
    ),
  ];
}

async function requireSameSeoOwner(
  tx: Prisma.TransactionClient,
  auditId: string,
  taskIds: string[],
) {
  const where = {
    taskId: { in: taskIds },
    OR: [{ projectId: { not: null } }, { auditId: { not: auditId } }],
  };
  if (
    (await tx.projectSeoAnalysis.findFirst({ where, select: { id: true } })) ||
    (await tx.projectSeoActionTask.findFirst({ where, select: { id: true } }))
  ) {
    throw conflict(
      "A related Task also belongs to another SEO report or project",
      { kind: CORE_API_ERROR_KINDS.SEO_AUDIT_TASK_SCOPE_CONFLICT },
    );
  }
}

export async function setSeoAuditTasksArchived(
  tx: Prisma.TransactionClient,
  actor: SeoWorkspaceActor,
  auditId: string,
  archived: boolean,
  archivedAt: Date,
): Promise<ChangedTask[]> {
  // A linked child may have been archived before its linked parent.
  // Restore in reverse order so the parent and its children can return together.
  const taskIds = archived
    ? await linkedTaskIds(tx, auditId)
    : (
        await tx.seoAudit.findUniqueOrThrow({
          where: { id: auditId },
          select: { archivedTaskIds: true },
        })
      ).archivedTaskIds.reverse();
  const scope = {
    workspaceId: actor.workspaceId,
    archivedAt: archived ? null : archivedAt,
  };
  // Lock only eligible Tasks in this workspace. That also fences any change to
  // placement, visibility or sub-tasks while applying the batch.
  const eligible = await tx.task.findMany({
    where: { ...scope, id: { in: taskIds } },
    select: { id: true },
  });
  const eligibleIds = eligible.map(({ id }) => id);
  await lockTaskRows(tx, eligibleIds);
  const where = { ...scope, id: { in: eligibleIds } };
  const accessible = await tx.task.findMany({
    where: { ...where, ...buildTaskWriteAccessWhere(actor.userId) },
    select: { id: true, ownerId: true, workspaceId: true },
  });
  if (accessible.length !== (await tx.task.count({ where }))) {
    throw notFound("Task not found");
  }
  const ownerless = accessible.find(({ ownerId }) => !ownerId);
  if (ownerless) {
    await requireRightOnWorkWithoutOwner(actor.userId, ownerless, "manage", tx);
  }

  const taskActor = { kind: "user" as const, userId: actor.userId };
  const accessibleIds = new Set(accessible.map(({ id }) => id));
  const changed = await setTerminalRootTasksArchived(
    tx,
    [...accessibleIds],
    archived,
    archivedAt,
    taskActor,
  );
  const changedTaskIds = changed.map(({ id }) => id);
  for (const id of changedTaskIds) accessibleIds.delete(id);
  for (const id of taskIds) {
    if (!accessibleIds.has(id)) continue;
    const task = await tx.task.findFirst({
      where: { id, ...scope },
    });
    // Another linked Task can already have taken its children with it.
    if (!task) continue;
    const subtree = archived
      ? await archiveTaskRecord(tx, task, { archivedAt })
      : await restoreTaskRecord(tx, task, taskActor);
    changedTaskIds.push(...subtree);
    changed.push({
      id: task.id,
      ownerId: task.ownerId,
      assigneeUserId: task.assigneeUserId,
    });
  }
  // A Task from another report can be attached below a linked Task. Check the
  // exact rows changed by the native cascade before committing the transaction.
  if (changedTaskIds.length)
    await requireSameSeoOwner(tx, auditId, changedTaskIds);
  await tx.seoAudit.update({
    where: { id: auditId },
    data: { archivedTaskIds: archived ? changed.map(({ id }) => id) : [] },
  });
  return changed;
}
