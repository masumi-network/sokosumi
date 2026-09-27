import { Channel, TaskStatus } from "@sokosumi/database";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, forbidden, notFound } from "@/helpers/error";
import {
  parseFutureRunAt,
  validateTaskAssigneeAssignment,
} from "@/helpers/task";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { CreateTaskScheduleRequest } from "@/schemas/task-schedule.schema";
import {
  canWriteTaskSchedule,
  type ScheduleActor,
} from "@/services/task-schedule.service";

import { shimCreateOperationId } from "./ids";
import {
  type LegacyOnceSchedule,
  type LegacyRecurringSchedule,
  mapRecurringRule,
  NEW_CREATE,
  parseMappedCreate,
} from "./rule";
import { type LegacyTaskView, legacyTaskView } from "./series";
import { type RouteVars, throwUnmappable } from "./vendor";

const SCHEDULABLE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.DRAFT,
  TaskStatus.READY,
  TaskStatus.QUEUED,
]);

/**
 * The Task a PUT schedules, checked after the caller passed the schedule
 * create gate. It must belong to the acting member, as the schedule will;
 * a Coworker must be one that may write that schedule; and, as before, only
 * a Task that has not started qualifies.
 */
export async function requireTaskBlueprint(
  actor: ScheduleActor,
  taskId: string,
) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      workspaceId: actor.workspace.workspaceId,
      ownerId: actor.userId,
      archivedAt: null,
    },
    include: { assignee: { select: { vendorId: true } } },
  });
  if (!task) {
    throw notFound("Task not found");
  }
  requireTaskNotParked(task);
  if (!canWriteTaskSchedule(actor, task)) {
    throw forbidden(
      "Coworkers can only schedule the acting member's Tasks they created, are assigned to, or that are assigned to their vendor siblings",
    );
  }
  if (!SCHEDULABLE_TASK_STATUSES.has(task.status)) {
    throw forbidden("You can only schedule draft, ready, or queued tasks");
  }
  return task;
}

/**
 * The schedule a recurring PUT makes from the Task. The create is keyed on
 * the Task, so a retry or a concurrent PUT replays the first schedule.
 */
export function mapTaskBlueprintToCreate(
  task: Awaited<ReturnType<typeof requireTaskBlueprint>>,
  schedule: LegacyRecurringSchedule,
): CreateTaskScheduleRequest {
  if (task.assigneeUserId != null) {
    throwUnmappable(
      `Task Schedules cannot be assigned to workspace members. Send assigneeId (Coworker) or assigneeSokoBotId on ${NEW_CREATE}.`,
      NEW_CREATE,
    );
  }
  if (task.runAt) {
    throwUnmappable(
      `This Task already starts once at its runAt. Use ${NEW_CREATE} for a repeating rule.`,
      NEW_CREATE,
    );
  }
  if (!task.name?.trim()) {
    throwUnmappable(
      `The Task has no name. Use ${NEW_CREATE} with name and a typed rule.`,
      NEW_CREATE,
    );
  }
  return parseMappedCreate({
    operationId: shimCreateOperationId(task.id),
    name: task.name,
    description: task.description,
    projectId: task.projectId,
    visibility: task.visibility,
    assigneeId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    rule: mapRecurringRule(schedule),
  });
}

/**
 * The old one-time schedule: the Task itself starts once at `runAt`, which is
 * the Task's Run at now. Queues it as PATCH /v1/tasks/{id} does.
 */
export async function setLegacyRunAt(
  vars: RouteVars,
  actor: ScheduleActor,
  taskId: string,
  schedule: LegacyOnceSchedule,
): Promise<LegacyTaskView> {
  const task = await requireTaskBlueprint(actor, taskId);
  const runAt = parseFutureRunAt(schedule.runAt);
  validateTaskAssigneeAssignment({
    status: TaskStatus.QUEUED,
    assigneeId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    assigneeUserId: task.assigneeUserId,
  });
  const updated = await prisma.$transaction(async (tx) => {
    if (
      !(await lockCalendarScope(
        tx,
        task.workspaceId,
        [task.projectId],
        actor.userId,
      )) ||
      !(await lockTaskRows(tx, [task.id]))
    ) {
      throw conflict("Task changed during update");
    }
    const { count } = await tx.task.updateMany({
      where: { id: task.id, status: task.status, archivedAt: null },
      data: { runAt, status: TaskStatus.QUEUED },
    });
    if (count === 0) {
      throw conflict("Task changed during update");
    }
    if (task.status !== TaskStatus.QUEUED) {
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          status: TaskStatus.QUEUED,
          channel: Channel.SOKOSUMI,
          ...resolveTaskEventActorFields(vars.authContext),
        },
      });
    }
    return await tx.task.findUnique({ where: { id: task.id } });
  });
  if (!updated) {
    throw notFound("Task not found");
  }
  await deliverCalendarInvalidationsNow(task.workspaceId);
  return legacyTaskView(updated);
}
