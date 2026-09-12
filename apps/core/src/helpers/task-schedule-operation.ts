import { createHash } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict } from "@/helpers/error";
import type { TaskScheduleInput } from "@/schemas/task-schedule.schema";

/**
 * Stable projection of a schedule rule for idempotency fingerprints: every
 * rule-affecting field in a fixed key order, with optional fields normalized to
 * `null` so an omitted and an explicitly empty field hash identically.
 */
export function canonicalTaskScheduleInput(schedule: TaskScheduleInput) {
  return schedule.mode === "once"
    ? {
        mode: "once",
        runAt: schedule.runAt,
      }
    : {
        mode: "recurring",
        expr: schedule.expr,
        timezone: schedule.timezone,
        endsMode: schedule.endsMode,
        endsOn: schedule.endsOn ?? null,
        occurrences: schedule.occurrences ?? null,
        intervalDays: schedule.intervalDays ?? null,
        anchorAt: schedule.anchorAt ?? null,
      };
}

/**
 * SHA-256 of an already canonical payload. Callers own the key order, so a
 * fingerprint only changes when the requested outcome changes.
 */
export function createTaskScheduleRequestFingerprint(
  canonicalPayload: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload), "utf8")
    .digest("hex");
}

interface TaskScheduleOperationClient {
  taskEvent: Pick<Prisma.TransactionClient["taskEvent"], "findUnique">;
}

export interface TaskScheduleOperationIdentity {
  taskId: string;
  operationId: string;
  requestFingerprint: string;
}

/**
 * Reports whether this series operation was already applied to the Task, using
 * the `(taskId, scheduleOperationId)` uniqueness the schedule audit trail
 * already carries. Callers replay by re-reading the Task rather than by
 * storing a rendered response.
 *
 * @throws 409 `idempotency_conflict` when the identity was reused for a
 * materially different request.
 */
export async function isTaskScheduleOperationReplay(
  tx: TaskScheduleOperationClient,
  operation: TaskScheduleOperationIdentity,
): Promise<boolean> {
  const existing = await tx.taskEvent.findUnique({
    where: {
      taskId_scheduleOperationId: {
        taskId: operation.taskId,
        scheduleOperationId: operation.operationId,
      },
    },
    select: { schedulePayload: true },
  });
  if (!existing) {
    return false;
  }

  const payload = existing.schedulePayload;
  const recordedFingerprint =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload.requestFingerprint
      : undefined;
  if (recordedFingerprint !== operation.requestFingerprint) {
    throw conflict(
      "This operation identity was already used for a different schedule operation on this Task",
      { kind: CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT },
    );
  }

  return true;
}
