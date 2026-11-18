import {
  type Prisma,
  TaskLinkType,
  type TaskVisibility,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { formatTaskIdentifier } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { lockTaskRows } from "@/helpers/calendar-locks";
import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
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

/** Sub-tasks have their own hierarchy; a PARENT Task link would be a second one. */
export async function requireNoSubtaskInParentLink(
  tx: Prisma.TransactionClient,
  type: TaskLinkType,
  taskIds: [string, string],
) {
  if (type !== TaskLinkType.PARENT) return;
  const subtasks = await tx.task.count({
    where: { id: { in: taskIds }, parentTaskId: { not: null } },
  });
  if (subtasks > 0) {
    throw badRequest("A sub-task cannot be a parent or child task");
  }
}

export interface SubtaskParent {
  id: string;
  projectId: string | null;
  visibility: TaskVisibility;
  ownerId: string | null;
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
  await lockTaskRows(tx, [input.parentTaskId]);
  const parent = await tx.task.findFirst({
    where: {
      id: input.parentTaskId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { id: true, projectId: true, visibility: true, ownerId: true },
  });
  if (!parent) throw notFound("Parent Task not found");
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
    UPDATE "task" AS t SET "position" = ordered.n
    FROM (
      SELECT "id", row_number() OVER (ORDER BY "position", "id") AS n
      FROM "task" WHERE "parentTaskId" = ${parentTaskId}
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
