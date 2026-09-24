import { isDeepStrictEqual } from "node:util";

import {
  Channel,
  type Prisma,
  TaskScheduleEventKind,
  TaskStatus,
} from "@sokosumi/database";
import { err, ok, type Result } from "neverthrow";

import { deliverTaskCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { validateTaskAssigneeAssignment } from "@/helpers/task";
import { notifyTaskCalendarAction } from "@/helpers/task-notifications";
import {
  buildTaskScheduleMetadata,
  computeScheduleNextRun,
  isSchedulableTaskStatus,
  validateScheduleInput,
} from "@/helpers/task-schedule";
import {
  removeTaskSchedulePlannedOccurrences,
  replaceTaskSchedulePlannedOccurrences,
  TaskScheduleOccurrenceLimitError,
} from "@/helpers/task-schedule-occurrence-index";
import { getTaskScheduleQuarantineAuditSnapshot } from "@/helpers/task-schedule-quarantine";
import { serializableTransaction } from "@/lib/db/transaction";
import type { TaskScheduleInput } from "@/schemas/task-schedule.schema";

interface BaseQuarantineActionInput {
  taskId: string;
  operationId: string;
  operatorId: string;
  reason: string;
}

interface RepairQuarantineInput extends BaseQuarantineActionInput {
  schedule: TaskScheduleInput;
}

export interface TaskScheduleQuarantineActionSuccess {
  status: "repaired" | "removed";
  taskId: string;
  taskName: string;
  eventId: string;
  ownerId: string;
  actorUserId: string | null;
  replayed: boolean;
}

export type TaskScheduleQuarantineActionError =
  | { kind: "not_found" }
  | { kind: "not_repairable"; reason: string }
  | { kind: "idempotency_conflict" };

export type TaskScheduleQuarantineActionResult = Result<
  TaskScheduleQuarantineActionSuccess,
  TaskScheduleQuarantineActionError
>;

type QuarantineAction = "repair_quarantine" | "remove_quarantined_schedule";

function getPayloadRecord(
  payload: Prisma.JsonValue | null,
): Prisma.JsonObject | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload;
}

function isExactReplay(
  payload: Prisma.JsonValue | null,
  action: QuarantineAction,
  reason: string,
  schedule?: TaskScheduleInput,
): payload is Prisma.JsonObject & { ownerId: string; taskName: string } {
  const record = getPayloadRecord(payload);
  if (
    !record ||
    record.action !== action ||
    record.reason !== reason ||
    typeof record.ownerId !== "string" ||
    typeof record.taskName !== "string"
  ) {
    return false;
  }

  return schedule == null
    ? record.schedule == null
    : isDeepStrictEqual(record.schedule, schedule);
}

async function findExistingAction(
  tx: Prisma.TransactionClient,
  input: BaseQuarantineActionInput,
  action: QuarantineAction,
  schedule?: TaskScheduleInput,
): Promise<TaskScheduleQuarantineActionResult | null> {
  const existing = await tx.taskEvent.findFirst({
    where: {
      taskId: input.taskId,
      scheduleOperationId: input.operationId,
    },
    select: {
      id: true,
      schedulePayload: true,
      userId: true,
    },
  });
  if (!existing) {
    return null;
  }

  if (
    !isExactReplay(existing.schedulePayload, action, input.reason, schedule)
  ) {
    return err({ kind: "idempotency_conflict" });
  }

  return ok({
    status: action === "repair_quarantine" ? "repaired" : "removed",
    taskId: input.taskId,
    taskName: existing.schedulePayload.taskName,
    eventId: existing.id,
    ownerId: existing.schedulePayload.ownerId,
    actorUserId: existing.userId,
    replayed: true,
  });
}

const QUARANTINE_OPERATION_SELECT = {
  id: true,
  taskId: true,
  reason: true,
  details: true,
  capturedMetadata: true,
  capturedNextRunAt: true,
  capturedStatus: true,
  task: {
    select: {
      id: true,
      ownerId: true,
      name: true,
      assigneeId: true,
      assigneeSokoBotId: true,
      assigneeUserId: true,
      status: true,
      metadata: true,
      nextRunAt: true,
      archivedAt: true,
      workspaceId: true,
      projectId: true,
    },
  },
} satisfies Prisma.TaskScheduleQuarantineSelect;

function quarantineSnapshotMatchesCurrentTask(
  quarantine: Prisma.TaskScheduleQuarantineGetPayload<{
    select: typeof QUARANTINE_OPERATION_SELECT;
  }>,
): boolean {
  return (
    quarantine.task.status === quarantine.capturedStatus &&
    quarantine.task.metadata === quarantine.capturedMetadata &&
    quarantine.task.nextRunAt?.getTime() ===
      quarantine.capturedNextRunAt?.getTime()
  );
}

async function lockAndReloadQuarantine(
  tx: Prisma.TransactionClient,
  quarantine: Prisma.TaskScheduleQuarantineGetPayload<{
    select: typeof QUARANTINE_OPERATION_SELECT;
  }>,
  operatorId: string,
) {
  const scopeLocked = await lockCalendarScope(
    tx,
    quarantine.task.workspaceId,
    [quarantine.task.projectId],
    operatorId,
  );
  if (!scopeLocked || !(await lockTaskRows(tx, [quarantine.taskId]))) {
    return null;
  }

  const current = await tx.taskScheduleQuarantine.findUnique({
    where: { taskId: quarantine.taskId },
    select: QUARANTINE_OPERATION_SELECT,
  });
  if (
    current &&
    (current.task.workspaceId !== quarantine.task.workspaceId ||
      current.task.projectId !== quarantine.task.projectId)
  ) {
    throw new Error("Task Calendar source changed during quarantine operation");
  }
  return current;
}

async function notifyQuarantineAction(
  result: TaskScheduleQuarantineActionSuccess,
): Promise<void> {
  await notifyTaskCalendarAction({
    taskId: result.taskId,
    taskName: result.taskName,
    ownerId: result.ownerId,
    actorUserId: result.actorUserId,
    eventId: result.eventId,
    messageKey:
      result.status === "repaired"
        ? "Notifications.Task.scheduleRepaired"
        : "Notifications.Task.scheduleRemovedByOperator",
    action: result.status,
  });
}

export async function repairTaskScheduleQuarantine(
  input: RepairQuarantineInput,
): Promise<TaskScheduleQuarantineActionResult> {
  validateScheduleInput(input.schedule);

  const result = await serializableTransaction(
    async (tx): Promise<TaskScheduleQuarantineActionResult> => {
      const replay = await findExistingAction(
        tx,
        input,
        "repair_quarantine",
        input.schedule,
      );
      if (replay) {
        return replay;
      }

      const quarantine = await tx.taskScheduleQuarantine.findUnique({
        where: { taskId: input.taskId },
        select: QUARANTINE_OPERATION_SELECT,
      });
      if (!quarantine) {
        return err({ kind: "not_found" });
      }
      const lockedQuarantine = await lockAndReloadQuarantine(
        tx,
        quarantine,
        input.operatorId,
      );
      if (!lockedQuarantine) {
        return err({ kind: "not_found" });
      }
      if (!quarantineSnapshotMatchesCurrentTask(lockedQuarantine)) {
        return err({
          kind: "not_repairable",
          reason: "Task schedule changed after it was quarantined",
        });
      }
      if (lockedQuarantine.task.archivedAt) {
        return err({
          kind: "not_repairable",
          reason: "Archived Tasks cannot be rescheduled",
        });
      }
      if (!isSchedulableTaskStatus(lockedQuarantine.task.status)) {
        return err({
          kind: "not_repairable",
          reason: `Task status ${lockedQuarantine.task.status} cannot be scheduled`,
        });
      }

      validateTaskAssigneeAssignment({
        status: TaskStatus.QUEUED,
        assigneeId: lockedQuarantine.task.assigneeId,
        assigneeSokoBotId: lockedQuarantine.task.assigneeSokoBotId,
        assigneeUserId: lockedQuarantine.task.assigneeUserId,
      });
      const metadata = buildTaskScheduleMetadata(input.schedule, new Date());
      const nextRunAt = computeScheduleNextRun(metadata);
      if (!nextRunAt) {
        return err({
          kind: "not_repairable",
          reason: "Unable to compute the next scheduled run",
        });
      }

      try {
        await replaceTaskSchedulePlannedOccurrences(tx, {
          id: input.taskId,
          workspaceId: lockedQuarantine.task.workspaceId,
          projectId: lockedQuarantine.task.projectId,
          schedule: metadata,
          nextRunAt,
        });
      } catch (error) {
        if (error instanceof TaskScheduleOccurrenceLimitError) {
          return err({ kind: "not_repairable", reason: error.message });
        }
        throw error;
      }
      await tx.task.update({
        where: { id: input.taskId },
        data: {
          metadata: JSON.stringify(metadata),
          nextRunAt,
          status: TaskStatus.QUEUED,
        },
      });
      const deleted = await tx.taskScheduleQuarantine.deleteMany({
        where: { id: lockedQuarantine.id, taskId: input.taskId },
      });
      if (deleted.count !== 1) {
        throw new Error("Task schedule quarantine changed during repair");
      }
      const event = await tx.taskEvent.create({
        data: {
          taskId: input.taskId,
          status: TaskStatus.QUEUED,
          userId: input.operatorId,
          channel: Channel.SOKOSUMI,
          scheduleKind: TaskScheduleEventKind.UPDATED,
          scheduleOperationId: input.operationId,
          schedulePayload: {
            action: "repair_quarantine",
            reason: input.reason,
            ownerId: lockedQuarantine.task.ownerId,
            taskName: lockedQuarantine.task.name,
            schedule: input.schedule,
            ...getTaskScheduleQuarantineAuditSnapshot(lockedQuarantine),
          },
        },
        select: { id: true },
      });

      return ok({
        status: "repaired",
        taskId: input.taskId,
        taskName: lockedQuarantine.task.name,
        eventId: event.id,
        ownerId: lockedQuarantine.task.ownerId,
        actorUserId: input.operatorId,
        replayed: false,
      });
    },
    "Task schedule quarantine changed concurrently",
  );
  if (result.isOk()) {
    await Promise.all([
      notifyQuarantineAction(result.value),
      deliverTaskCalendarInvalidationsNow(result.value.taskId),
    ]);
  }
  return result;
}

export async function removeTaskScheduleQuarantine(
  input: BaseQuarantineActionInput,
): Promise<TaskScheduleQuarantineActionResult> {
  const result = await serializableTransaction(
    async (tx): Promise<TaskScheduleQuarantineActionResult> => {
      const replay = await findExistingAction(
        tx,
        input,
        "remove_quarantined_schedule",
      );
      if (replay) {
        return replay;
      }

      const quarantine = await tx.taskScheduleQuarantine.findUnique({
        where: { taskId: input.taskId },
        select: QUARANTINE_OPERATION_SELECT,
      });
      if (!quarantine) {
        return err({ kind: "not_found" });
      }
      const lockedQuarantine = await lockAndReloadQuarantine(
        tx,
        quarantine,
        input.operatorId,
      );
      if (!lockedQuarantine) {
        return err({ kind: "not_found" });
      }
      if (!quarantineSnapshotMatchesCurrentTask(lockedQuarantine)) {
        return err({
          kind: "not_repairable",
          reason: "Task schedule changed after it was quarantined",
        });
      }

      await tx.task.update({
        where: { id: input.taskId },
        data: {
          metadata: null,
          nextRunAt: null,
          status: TaskStatus.DRAFT,
        },
      });
      await removeTaskSchedulePlannedOccurrences(tx, input.taskId);
      const deleted = await tx.taskScheduleQuarantine.deleteMany({
        where: { id: lockedQuarantine.id, taskId: input.taskId },
      });
      if (deleted.count !== 1) {
        throw new Error("Task schedule quarantine changed during removal");
      }
      const event = await tx.taskEvent.create({
        data: {
          taskId: input.taskId,
          status: TaskStatus.DRAFT,
          userId: input.operatorId,
          channel: Channel.SOKOSUMI,
          scheduleKind: TaskScheduleEventKind.REMOVED,
          scheduleOperationId: input.operationId,
          schedulePayload: {
            action: "remove_quarantined_schedule",
            reason: input.reason,
            ownerId: lockedQuarantine.task.ownerId,
            taskName: lockedQuarantine.task.name,
            ...getTaskScheduleQuarantineAuditSnapshot(lockedQuarantine),
          },
        },
        select: { id: true },
      });

      return ok({
        status: "removed",
        taskId: input.taskId,
        taskName: lockedQuarantine.task.name,
        eventId: event.id,
        ownerId: lockedQuarantine.task.ownerId,
        actorUserId: input.operatorId,
        replayed: false,
      });
    },
    "Task schedule quarantine changed concurrently",
  );
  if (result.isOk()) {
    await Promise.all([
      notifyQuarantineAction(result.value),
      deliverTaskCalendarInvalidationsNow(result.value.taskId),
    ]);
  }
  return result;
}
