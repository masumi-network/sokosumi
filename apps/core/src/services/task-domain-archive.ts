import { type Prisma, type Task, TaskStatus } from "@sokosumi/database";
import {
  canArchiveTaskStatus,
  getTaskCannotArchiveMessage,
} from "@sokosumi/utils";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { TASK_RESTORED_COMMENT } from "@/helpers/task-reopen-instructions";
import { touchTaskRow } from "@/helpers/task-subtasks";
import {
  requireSeoTaskReactivation,
  SEO_INACTIVE_TASK_STATUSES,
} from "./project-seo-analysis-concurrency";
import type { TaskDomainActor } from "./task-domain.service";
import { eventActorFields } from "./task-domain-event-actor";

/** Shared archive mutation after the caller has established archive access. */
export async function archiveTaskRecord(
  tx: Prisma.TransactionClient,
  task: Task,
  options: {
    expectedUpdatedAt?: Date;
    actor?: TaskDomainActor;
    effectEventId?: string;
  } = {},
): Promise<void> {
  if (!canArchiveTaskStatus(task.status))
    throw unprocessableEntity(getTaskCannotArchiveMessage(task.status));
  // A generated Task is independent of its recurring parent (ADR 0041).
  // The bot must not cancel a future one-off run as a side effect of archive.
  if (
    options.actor?.kind === "soko_bot" &&
    task.runAt &&
    task.runAt > new Date()
  ) {
    throw unprocessableEntity(
      "Remove the future Run at before archiving this Task",
    );
  }
  if (
    options.expectedUpdatedAt &&
    task.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()
  )
    throw conflict("Task changed; read it again");
  // Sub-tasks go with their Task, so none is left live under an archived one.
  const subtasks = await liveSubtasks(tx, task.id, options.actor);
  const archivedAt = new Date();
  const result = await tx.task.updateMany({
    where: {
      id: task.id,
      archivedAt: null,
      status: task.status,
      updatedAt: task.updatedAt,
    },
    data: { archivedAt },
  });
  if (result.count !== 1)
    throw conflict("Task was modified concurrently; retry archive");
  if (subtasks.length > 0) {
    // Only in the status checked above: one that started running since stops
    // the archive.
    const archived = await tx.task.updateMany({
      where: { archivedAt: null, OR: subtasks },
      data: { archivedAt },
    });
    if (archived.count !== subtasks.length)
      throw conflict("A sub-task changed while archiving; retry archive");
  }
  if (options.effectEventId && options.actor) {
    await tx.taskEvent.create({
      data: {
        id: options.effectEventId,
        taskId: task.id,
        comment: "Task archived",
        ...eventActorFields(options.actor),
      },
    });
  }
}

/** Statuses that come back unchanged; nothing runs from them. */
const RESTORE_KEEPS_STATUS: readonly TaskStatus[] = [
  TaskStatus.DRAFT,
  TaskStatus.CANCELED,
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
];

/**
 * Brings an archived Task back onto the board after the caller has
 * established manage access. A Task that was waiting to run (Queued, Ready,
 * waiting for a vendor grant) comes back as a Draft without its Run at, so
 * restoring never starts work or spends credits on its own. Notifications
 * marked read at archive stay read.
 */
export async function restoreTaskRecord(
  tx: Prisma.TransactionClient,
  task: Task,
  actor: TaskDomainActor,
): Promise<void> {
  if (task.parentTaskId) {
    // Lock, then write the parent row, as requireSubtaskParent does after
    // its Workspace and Project locks: no archive of the parent slips past
    // this restore, at any isolation level.
    await lockTaskRows(tx, [task.parentTaskId]);
    await touchTaskRow(tx, task.parentTaskId);
    const parent = await tx.task.findUnique({
      where: { id: task.parentTaskId },
      select: { archivedAt: true },
    });
    if (parent?.archivedAt)
      throw unprocessableEntity(
        "Restore the Task this sub-task belongs to first",
      );
  }
  if (!SEO_INACTIVE_TASK_STATUSES.includes(task.status))
    await requireSeoTaskReactivation(tx, task.id);
  const keepStatus = RESTORE_KEEPS_STATUS.includes(task.status);
  const result = await tx.task.updateMany({
    where: {
      id: task.id,
      archivedAt: { not: null },
      updatedAt: task.updatedAt,
    },
    data: {
      archivedAt: null,
      ...(keepStatus
        ? {}
        : {
            status: TaskStatus.DRAFT,
            runAt: null,
            pendingVendorGrantId: null,
            grantResumeStatus: null,
          }),
    },
  });
  if (result.count !== 1)
    throw conflict("Task was modified concurrently; retry restore");
  await tx.taskEvent.create({
    data: {
      taskId: task.id,
      comment: TASK_RESTORED_COMMENT,
      ...(keepStatus ? {} : { status: TaskStatus.DRAFT }),
      ...eventActorFields(actor),
    },
  });
  // Sub-tasks archived with it share its archivedAt; one archived on its own
  // before then stays archived.
  if (task.archivedAt) {
    const subtasks = await tx.task.findMany({
      where: { parentTaskId: task.id, archivedAt: task.archivedAt },
    });
    for (const subtask of subtasks) {
      await restoreTaskRecord(tx, subtask, actor);
    }
  }
}

/** Every live sub-task below a Task, at any depth. Refuses one that cannot be archived. */
async function liveSubtasks(
  tx: Prisma.TransactionClient,
  taskId: string,
  actor: TaskDomainActor | undefined,
): Promise<{ id: string; status: TaskStatus }[]> {
  const found: { id: string; status: TaskStatus }[] = [];
  let level = [taskId];
  while (level.length > 0) {
    // A sub-task created or restored meanwhile writes its parent first, so it
    // waits for this archive and then finds the parent archived; one that
    // committed after a SERIALIZABLE snapshot fails this lock, and the
    // archive retries.
    await lockTaskRows(tx, level);
    const subtasks = await tx.task.findMany({
      where: { parentTaskId: { in: level }, archivedAt: null },
      select: { id: true, status: true, runAt: true },
    });
    const blocked = subtasks.find(
      (subtask) => !canArchiveTaskStatus(subtask.status),
    );
    if (blocked) {
      throw unprocessableEntity(
        `A sub-task is ${blocked.status.toLowerCase().replaceAll("_", " ")}. Finish or cancel it before archiving this Task.`,
      );
    }
    // As for the Task itself: the bot must not cancel a future run.
    if (
      actor?.kind === "soko_bot" &&
      subtasks.some((subtask) => subtask.runAt && subtask.runAt > new Date())
    ) {
      throw unprocessableEntity(
        "A sub-task has a future Run at. Remove it before archiving this Task.",
      );
    }
    level = subtasks.map((subtask) => subtask.id);
    found.push(...subtasks.map(({ id, status }) => ({ id, status })));
  }
  return found;
}
