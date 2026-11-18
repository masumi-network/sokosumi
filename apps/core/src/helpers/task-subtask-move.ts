import { type Prisma, type Task, TaskVisibility } from "@sokosumi/database";
import { isTaskEditableStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { requireTaskWriteAccess } from "@/helpers/access-control";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, forbidden, unprocessableEntity } from "@/helpers/error";
import { requireSeoTaskExecutionUnchanged } from "@/helpers/seo-task-execution";
import {
  loadTaskAncestors,
  lockSubtaskTree,
  newSubtaskPosition,
  requireSubtasksCanChangeProject,
  subtaskPositionAfter,
  touchTaskRow,
} from "@/helpers/task-subtasks";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import type { UserContext } from "@/middleware/auth";

const MOVE_CONFLICT_MESSAGE = "Task changed while moving it. Retry.";

export interface MoveTaskInput {
  taskId: string;
  /** Absent keeps the parent. A string attaches or re-parents; null detaches. */
  parentTaskId?: string | null;
  /** The sibling to go after; null goes first. Absent keeps the order, or goes last under a new parent. */
  afterTaskId?: string | null;
}

export interface MoveTaskResult {
  task: Task;
  /** The Task and its sub-tasks moved to the new parent's project. */
  projectChanged: boolean;
}

/**
 * Moves a Task in the sub-task tree: reorders it among its siblings, puts it
 * under another parent, or detaches it. Run it in `serializableTransaction`:
 * a concurrent change to a row this read fails and retries instead of
 * writing a stale tree. The `task_subtask_guard` trigger enforces the same
 * rules as a backstop.
 */
export async function moveTask(
  tx: Prisma.TransactionClient,
  userContext: UserContext,
  input: MoveTaskInput,
): Promise<MoveTaskResult> {
  const task = await requireTaskWriteAccess(userContext, input.taskId, tx, {
    right: "edit",
  });
  const { parentTaskId, afterTaskId } = input;
  if (parentTaskId === undefined || parentTaskId === task.parentTaskId) {
    return {
      task: await reorderSubtask(tx, task, afterTaskId),
      projectChanged: false,
    };
  }
  if (parentTaskId === null) {
    return {
      task: await detachSubtask(tx, task, afterTaskId),
      projectChanged: false,
    };
  }
  return attachSubtask(tx, userContext, task, parentTaskId, afterTaskId);
}

async function reorderSubtask(
  tx: Prisma.TransactionClient,
  task: Task,
  afterTaskId: string | null | undefined,
): Promise<Task> {
  if (afterTaskId === undefined) return task;
  if (!task.parentTaskId) {
    throw unprocessableEntity("Only a sub-task can be reordered");
  }
  // The same lock sub-task creates take, so sibling writes serialize. The
  // parent before the Task, top-down as an archive locks.
  if (
    !(await lockTaskRows(tx, [task.parentTaskId])) ||
    !(await lockTaskRows(tx, [task.id]))
  ) {
    throw conflict(MOVE_CONFLICT_MESSAGE);
  }
  const position = await subtaskPositionAfter(tx, {
    parentTaskId: task.parentTaskId,
    taskId: task.id,
    afterTaskId,
  });
  return tx.task.update({ where: { id: task.id }, data: { position } });
}

/** The Task leaves its parent and keeps its project. */
async function detachSubtask(
  tx: Prisma.TransactionClient,
  task: Task,
  afterTaskId: string | null | undefined,
): Promise<Task> {
  const oldParentTaskId = task.parentTaskId;
  if (!oldParentTaskId) return task;
  if (afterTaskId) {
    throw unprocessableEntity("afterTaskId needs a parent Task");
  }
  // Lock, then write the old parent, as requireSubtaskParent does: a
  // SERIALIZABLE archive of the old parent that read this sub-task fails
  // and retries instead of archiving a Task that left. The parent before the
  // Task, top-down as an archive locks.
  if (
    !(await lockTaskRows(tx, [oldParentTaskId])) ||
    !(await lockTaskRows(tx, [task.id]))
  ) {
    throw conflict(MOVE_CONFLICT_MESSAGE);
  }
  await touchTaskRow(tx, oldParentTaskId);
  return tx.task.update({
    where: { id: task.id },
    data: { parentTaskId: null, position: null },
  });
}

async function attachSubtask(
  tx: Prisma.TransactionClient,
  userContext: UserContext,
  task: Task,
  parentTaskId: string,
  afterTaskId: string | null | undefined,
): Promise<MoveTaskResult> {
  if (parentTaskId === task.id) {
    throw unprocessableEntity("A Task cannot be its own sub-task");
  }
  const parent = await requireTaskWriteAccess(userContext, parentTaskId, tx, {
    right: "edit",
  });
  if (parent.workspaceId !== task.workspaceId) {
    throw unprocessableEntity(
      "A sub-task stays in its parent's workspace. Move the Task to that workspace first.",
    );
  }
  // Workspace and Project first, in the order a Task PATCH takes them. Then
  // the Task rows top-down, as an archive locks them: both parents, the Task,
  // then its sub-tasks level by level, all by depth and then by id. Then
  // write both parents, so a SERIALIZABLE archive that read either one's
  // sub-tasks earlier fails and retries.
  const oldParentTaskId = task.parentTaskId;
  if (
    !(await lockCalendarScope(
      tx,
      task.workspaceId,
      [task.projectId, parent.projectId],
      userContext.userId,
    ))
  ) {
    throw conflict(MOVE_CONFLICT_MESSAGE);
  }
  // The new parent's chain, itself included: its length is the Task's new level.
  const chain = await loadTaskAncestors(parent.id, tx);
  const taskDepth = (await loadTaskAncestors(oldParentTaskId, tx)).length;
  // Locked before the height below is read: a sub-task added meanwhile wrote
  // its parent, so this lock fails and the move retries.
  const subtaskLevels = await lockSubtaskTree(
    tx,
    task.id,
    [
      { id: parent.id, depth: chain.length - 1 },
      ...(oldParentTaskId
        ? [{ id: oldParentTaskId, depth: taskDepth - 1 }]
        : []),
      { id: task.id, depth: taskDepth },
    ],
    taskDepth,
  );
  await touchTaskRow(tx, parent.id);
  if (oldParentTaskId) await touchTaskRow(tx, oldParentTaskId);

  if (parent.visibility !== task.visibility) {
    throw unprocessableEntity(
      "A sub-task has its parent's visibility. A private Task and a public Task cannot be parent and sub-task.",
    );
  }
  if (
    parent.visibility === TaskVisibility.PRIVATE &&
    parent.ownerId !== task.ownerId
  ) {
    throw unprocessableEntity(
      "Only the Owner of a private Task can add sub-tasks to it",
    );
  }
  if (chain.some((ancestor) => ancestor.id === task.id)) {
    throw unprocessableEntity(
      "A Task cannot go under one of its own sub-tasks",
    );
  }
  if (chain.length + subtaskLevels.length > LIMITS.MAX_SUBTASK_DEPTH) {
    throw unprocessableEntity(
      `Sub-tasks nest at most ${LIMITS.MAX_SUBTASK_DEPTH} levels deep`,
    );
  }

  const projectChanged = parent.projectId !== task.projectId;
  if (projectChanged) {
    // The same guards as a project change by PATCH. The sub-tasks follow
    // through the task_subtask_follow_parent trigger, so they get the
    // guards too.
    requireTaskNotParked(task);
    if (!isTaskEditableStatus(task.status)) {
      throw forbidden("You can only update draft, queued, or ready tasks");
    }
    await requireSeoTaskExecutionUnchanged(tx, task, {
      projectId: parent.projectId,
    });
    await requireSubtasksCanChangeProject(tx, subtaskLevels.flat());
  }
  const position =
    afterTaskId === undefined
      ? await newSubtaskPosition(tx, parent.id, null)
      : await subtaskPositionAfter(tx, {
          parentTaskId: parent.id,
          taskId: task.id,
          afterTaskId,
        });
  const moved = await tx.task.update({
    where: { id: task.id },
    data: {
      parentTaskId: parent.id,
      position,
      ...(projectChanged ? { projectId: parent.projectId } : {}),
    },
  });
  return { task: moved, projectChanged };
}
