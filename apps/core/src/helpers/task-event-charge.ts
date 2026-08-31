import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

import { conflict } from "./error.js";
import { getTaskStatusUpdateDataForEvent } from "./task.js";
import {
  createTaskEventTransaction,
  isInsufficientBalanceError,
} from "./task-credits.js";

/**
 * Statuses that may be paused to OUT_OF_CREDITS on insufficient balance.
 * Terminal tasks (COMPLETED/FAILED/CANCELED) and already-OUT_OF_CREDITS keep
 * their status — a failed charge on those surfaces as a plain 422 instead.
 *
 * Extracted from the task-events route so the x402 pay endpoint charges
 * through the exact same machinery (PR1-SPEC §3.5): one debit path, one
 * out-of-credits pause rule.
 */
export const OUT_OF_CREDITS_PAUSE_STATUSES = new Set<TaskStatus>([
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.RUNNING,
  TaskStatus.AWAITING_EXTERNAL,
]);

/**
 * Applies a task status transition guarded against concurrent movement: the
 * row must still be at the status this request read, or the transaction
 * rolls back with a 409. Shared by the task-events route (every
 * caller-requested or charge-replaced status) and the x402 pay flow's
 * OUT_OF_CREDITS pause, so the guard — and its load-bearing conflict
 * message — cannot drift between the two writers of the same transition.
 */
export async function applyGuardedTaskStatusUpdate(params: {
  tx: Prisma.TransactionClient;
  taskId: string;
  expectedStatus: TaskStatus;
  eventStatus: TaskStatus;
}): Promise<void> {
  const updateResult = await params.tx.task.updateMany({
    where: { id: params.taskId, status: params.expectedStatus },
    data: {
      ...getTaskStatusUpdateDataForEvent(params.eventStatus),
      ...(params.expectedStatus === TaskStatus.QUEUED &&
      params.eventStatus !== TaskStatus.QUEUED
        ? { metadata: null, nextRunAt: null }
        : {}),
    },
  });
  if (updateResult.count !== 1) {
    throw conflict("Task status was changed by another request");
  }
}

export async function chargeTaskCreditsOrMarkOutOfCredits(params: {
  userId: string;
  organizationId: string | null;
  cents: bigint;
  currentStatus: TaskStatus;
  tx: Prisma.TransactionClient;
}): Promise<{
  transactionId: string | null;
  /** When set, the billed status was rejected for balance and replaced. */
  eventStatus: TaskStatus | null;
}> {
  try {
    const transactionId = await createTaskEventTransaction({
      userId: params.userId,
      organizationId: params.organizationId,
      cents: params.cents,
      tx: params.tx,
    });
    return { transactionId, eventStatus: null };
  } catch (error) {
    // Terminal tasks (COMPLETED/FAILED/CANCELED) and already-OUT_OF_CREDITS keep
    // their status — rethrow as 422. Only mid-run tasks pause to OUT_OF_CREDITS.
    if (
      !isInsufficientBalanceError(error) ||
      !OUT_OF_CREDITS_PAUSE_STATUSES.has(params.currentStatus)
    ) {
      throw error;
    }
    // Caller persists OUT_OF_CREDITS then returns 422 (not the requested
    // outcome — the billed action did not land).
    return { transactionId: null, eventStatus: TaskStatus.OUT_OF_CREDITS };
  }
}
