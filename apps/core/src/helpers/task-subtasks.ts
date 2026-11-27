import type { Prisma, TaskVisibility } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { formatTaskIdentifier } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { requireNoSeoTaskExecution } from "@/helpers/seo-task-execution";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import type prisma from "@/lib/db/prisma";

type Db = Pick<typeof prisma, "task">;

/** The Tasks above a sub-task, root first. Empty for a Task on the board. */
export async function loadTaskAncestors(parentTaskId: string | null, db: Db) {
  const ancestors = [];
  let nextId = parentTaskId;
  // A chain is a root plus at most MAX_SUBTASK_DEPTH levels of sub-tasks.
  while (nextId && ancestors.length <= LIMITS.MAX_SUBTASK_DEPTH) {
    const row = await db.task.findUnique({
      where: { id: nextId },
      select: {
        id: true,
        name: true,
        status: true,
        number: true,
        parentTaskId: true,
        project: { select: { identifier: true } },
      },
    });
    if (!row) break;
    ancestors.unshift({
      id: row.id,
      identifier: formatTaskIdentifier(row.project?.identifier, row.number),
      name: row.name,
      status: row.status,
    });
    nextId = row.parentTaskId;
  }
  return ancestors;
}

/** A sub-task's project and workspace follow its parent; they never change alone. */
export function requireNotSubtask(task: { parentTaskId: string | null }) {
  if (task.parentTaskId) {
    throw unprocessableEntity(
      "A sub-task stays in its parent's project and workspace. Move the parent instead.",
    );
  }
}

/** A Task row, and its depth: the number of Tasks above it. */
export interface TaskAtDepth {
  id: string;
  depth: number;
}

/**
 * Locks the sub-tasks below a Task, top-down as an archive does: each level
 * after the one above it, one query per level. Returns their ids by level,
 * so the length is the height of the tree. Lock the Task itself first, or
 * pass it in `alongside`.
 *
 * `alongside` are more rows to lock in the same pass, at their own depth
 * (`taskDepth` is the Task's). Every row then locks in one global order: by
 * depth, then by id. An archive locks a tree in that order too, so the two
 * never wait for each other in reverse.
 *
 * Under SERIALIZABLE, a sub-task created, restored or moved since this
 * transaction's snapshot wrote its parent row, so the lock on that row fails
 * with 40001 and the caller retries instead of reading a stale tree.
 */
export async function lockSubtaskTree(
  tx: Prisma.TransactionClient,
  taskId: string,
  alongside: TaskAtDepth[] = [],
  taskDepth = 0,
): Promise<string[][]> {
  const levels: string[][] = [];
  const depths = alongside.map((row) => row.depth);
  const lastDepth = Math.max(taskDepth, ...depths);
  let level = [taskId];
  for (let depth = Math.min(taskDepth, ...depths); ; depth += 1) {
    if (depth > taskDepth && level.length > 0) {
      // Stored trees are at most MAX_SUBTASK_DEPTH deep, so the bound only
      // stops a walk over rows the guard never saw.
      const children =
        levels.length < LIMITS.MAX_SUBTASK_DEPTH
          ? await tx.task.findMany({
              where: { parentTaskId: { in: level } },
              select: { id: true },
            })
          : [];
      level = children.map((child) => child.id);
      if (level.length > 0) levels.push(level);
    }
    const ids = alongside
      .filter((row) => row.depth === depth)
      .map((row) => row.id);
    if (depth > taskDepth) ids.push(...level);
    if (ids.length > 0 && !(await lockTaskRows(tx, ids))) {
      throw conflict("A sub-task changed meanwhile. Retry.");
    }
    if (depth >= lastDepth && depth > taskDepth && level.length === 0) {
      return levels;
    }
  }
}

/**
 * Sub-tasks follow their Task to another Project (task_subtask_follow_parent),
 * so each one gets the guards a Project change by PATCH applies to the Task:
 * not parked, and no frozen SEO analysis. Lock them first (lockSubtaskTree).
 */
export async function requireSubtasksCanChangeProject(
  tx: Prisma.TransactionClient,
  subtaskIds: string[],
): Promise<void> {
  if (subtaskIds.length === 0) return;
  const subtasks = await tx.task.findMany({
    where: { id: { in: subtaskIds } },
    select: { status: true },
  });
  for (const subtask of subtasks) requireTaskNotParked(subtask);
  await requireNoSeoTaskExecution(tx, subtaskIds);
}

/** lockSubtaskTree, then requireSubtasksCanChangeProject. Lock the Task first. */
export async function requireSubtreeCanChangeProject(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  const levels = await lockSubtaskTree(tx, taskId);
  await requireSubtasksCanChangeProject(tx, levels.flat());
}

export interface SubtaskParent {
  id: string;
  projectId: string | null;
  visibility: TaskVisibility;
  ownerId: string | null;
}

/** A no-op write: a SERIALIZABLE reader whose snapshot is older fails on it. */
export async function touchTaskRow(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  await tx.$executeRaw`UPDATE ${sharedTable("task")} SET "position" = "position" WHERE "id" = ${taskId}`;
}

/**
 * Locks and checks the Task a new sub-task goes under. The lock serializes
 * sibling inserts, so two creates never take the same position. The
 * `task_subtask_guard` trigger enforces the same rules as a backstop.
 */
export async function requireSubtaskParent(
  tx: Prisma.TransactionClient,
  input: {
    parentTaskId: string;
    workspaceId: string;
    ownerId: string | null;
  },
): Promise<SubtaskParent> {
  const placement = await tx.task.findFirst({
    where: {
      id: input.parentTaskId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { projectId: true },
  });
  if (!placement) throw notFound("Parent Task not found");
  // Workspace and Project before the Task row, in the order a Task PATCH
  // takes them; the insert below needs both.
  if (!(await lockCalendarScope(tx, input.workspaceId, [placement.projectId])))
    throw conflict("Parent Task changed while adding a sub-task");
  // Lock, then write. The lock comes first: a status event on the parent
  // holds its key share and then its history row, and the write's
  // history_task_sync would wait on that row while the event waits on us.
  // The write makes a SERIALIZABLE archive that read earlier fail and retry,
  // where a lock alone would let it miss the new sub-task.
  await lockTaskRows(tx, [input.parentTaskId]);
  await touchTaskRow(tx, input.parentTaskId);
  const parent = await tx.task.findFirst({
    where: {
      id: input.parentTaskId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { id: true, projectId: true, visibility: true, ownerId: true },
  });
  if (!parent) throw notFound("Parent Task not found");
  if (parent.projectId !== placement.projectId)
    throw conflict("Parent Task changed while adding a sub-task");
  if (parent.visibility === "PRIVATE" && parent.ownerId !== input.ownerId) {
    throw unprocessableEntity(
      "Only the Owner of a private Task can add sub-tasks to it",
    );
  }
  // The parent's chain, itself included: its length is the new sub-task's level.
  const chain = await loadTaskAncestors(parent.id, tx);
  if (chain.length > LIMITS.MAX_SUBTASK_DEPTH) {
    throw unprocessableEntity(
      `Sub-tasks nest at most ${LIMITS.MAX_SUBTASK_DEPTH} levels deep`,
    );
  }
  return parent;
}

/** Spreads a parent's sub-tasks to positions 1..n in their current order. */
async function renumberSubtaskPositions(
  tx: Prisma.TransactionClient,
  parentTaskId: string,
) {
  await tx.$executeRaw(PrismaRaw.sql`
    UPDATE ${sharedTable("task")} AS t SET "position" = ordered.n
    FROM (
      SELECT "id", row_number() OVER (ORDER BY "position", "id") AS n
      FROM ${sharedTable("task")} WHERE "parentTaskId" = ${parentTaskId}
    ) AS ordered
    WHERE t."id" = ordered."id"
  `);
}

/**
 * A position that places a sub-task directly after `afterTaskId`, or first
 * when it is null. `taskId` is the sub-task being moved, null for a new one.
 * Same rule as table row order (`positionAfter` in helpers/data-table.ts).
 */
export async function subtaskPositionAfter(
  tx: Prisma.TransactionClient,
  input: {
    parentTaskId: string;
    taskId: string | null;
    afterTaskId: string | null;
  },
  renumbered = false,
): Promise<number> {
  const { parentTaskId, taskId, afterTaskId } = input;
  if (afterTaskId !== null && afterTaskId === taskId) {
    throw unprocessableEntity("A sub-task cannot move after itself");
  }
  const siblings = { parentTaskId, ...(taskId ? { id: { not: taskId } } : {}) };
  const lower = afterTaskId
    ? await tx.task.findFirst({
        where: { ...siblings, id: afterTaskId },
        select: { id: true, position: true },
      })
    : null;
  if (afterTaskId && (lower === null || lower.position === null)) {
    throw unprocessableEntity("afterTaskId is not a sub-task of this parent");
  }
  const upper = await tx.task.findFirst({
    where: {
      ...siblings,
      ...(lower?.position != null
        ? {
            OR: [
              { position: { gt: lower.position } },
              { position: lower.position, id: { gt: lower.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { position: true },
  });
  const lowerPosition = lower?.position ?? null;
  const upperPosition = upper?.position ?? null;
  if (lowerPosition === null) {
    return upperPosition === null ? 1 : upperPosition - 1;
  }
  if (upperPosition === null) return lowerPosition + 1;
  const middle = (lowerPosition + upperPosition) / 2;
  if (lowerPosition < middle && middle < upperPosition) return middle;
  // Equal neighbours or exhausted float precision: spread positions and retry.
  if (renumbered) throw conflict("Sub-task order could not be updated. Retry.");
  await renumberSubtaskPositions(tx, parentTaskId);
  return subtaskPositionAfter(tx, input, true);
}

/** Where a new sub-task goes: after `afterTaskId`, else last. */
export async function newSubtaskPosition(
  tx: Prisma.TransactionClient,
  parentTaskId: string,
  afterTaskId: string | null | undefined,
): Promise<number> {
  if (afterTaskId) {
    return subtaskPositionAfter(tx, {
      parentTaskId,
      taskId: null,
      afterTaskId,
    });
  }
  const last = await tx.task.findFirst({
    where: { parentTaskId },
    orderBy: [{ position: "desc" }, { id: "desc" }],
    select: { position: true },
  });
  return (last?.position ?? 0) + 1;
}
