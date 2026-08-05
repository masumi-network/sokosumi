import { convertCentsToCredits, SokosumiJobStatus } from "@sokosumi/utils";

import {
  AgentJobStatus,
  JobType,
  NextJobAction,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Job } from "../generated/prisma/client.js";
import {
  type FreeJobWithStatus,
  type JobEventForListSummary,
  type JobEventForStatusCompute,
  type JobEventWithRelations,
  type JobForStatusCompute,
  type JobWithEvents,
  type JobWithPurchase,
  type JobWithSokosumiStatus,
  type JobWithTransaction,
  type PaidJobWithStatus,
} from "../types/job.js";

const TEN_MINUTES_TIMESTAMP = 1000 * 60 * 10; // 10min

export const ACTIVE_PURCHASE_NEXT_ACTIONS: NextJobAction[] = [
  NextJobAction.FUNDS_LOCKING_INITIATED,
  NextJobAction.FUNDS_LOCKING_REQUESTED,
  NextJobAction.SET_REFUND_REQUESTED_INITIATED,
  NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  NextJobAction.UNSET_REFUND_REQUESTED_INITIATED,
  NextJobAction.UNSET_REFUND_REQUESTED_REQUESTED,
];

function hasPaymentWindowExpired(
  job: Pick<Job, "createdAt" | "payByTime">,
  now: Date,
): boolean {
  const paymentDeadline = job.payByTime ?? job.createdAt;
  return paymentDeadline.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP;
}

/**
 * Returns the latest (most recent) job event from a job's events array.
 *
 * This helper assumes that events are ordered descending by `createdAt`,
 * which is enforced by event `orderBy` in `jobWithEvents` / `jobForStatusComputeSelect`.
 * The latest event is the first element in the array.
 *
 * @param job - An object containing an `events` array.
 * @returns The latest event, or `undefined` if the events array is empty.
 */
export function getLatestJobEvent(job: {
  events: readonly JobEventForStatusCompute[];
}): JobEventForStatusCompute | undefined {
  return job.events.at(0);
}

function checkPaymentStatus(
  job: Pick<JobForStatusCompute, "createdAt" | "payByTime" | "purchase">,
  now: Date,
): SokosumiJobStatus | null {
  const purchase = job.purchase;
  if (!purchase) {
    if (hasPaymentWindowExpired(job, now)) {
      return SokosumiJobStatus.PAYMENT_FAILED;
    } else {
      return SokosumiJobStatus.PAYMENT_PENDING;
    }
  }
  return null;
}

/**
 * Determines the next actionable status for a job based on its `nextAction` property.
 *
 * Maps the job's `nextAction` to a corresponding `JobStatus` if applicable.
 * - Returns `PAYMENT_PENDING` if the next action is related to funds locking.
 * - Returns `REFUND_PENDING` if the next action is related to refund requests (set/unset).
 * - Returns `null` for actions that do not correspond to a specific status or are not actionable.
 *
 * @param job - The job object to evaluate.
 * @returns The corresponding `JobStatus` if the next action maps to a status, otherwise `null`.
 */
function checkNextAction(
  job: Pick<JobForStatusCompute, "purchase">,
): SokosumiJobStatus | null {
  const purchase = job.purchase;
  if (!purchase) {
    return SokosumiJobStatus.PAYMENT_PENDING;
  }

  switch (purchase.nextAction) {
    case NextJobAction.FUNDS_LOCKING_INITIATED:
    case NextJobAction.FUNDS_LOCKING_REQUESTED:
      return SokosumiJobStatus.PAYMENT_PENDING;
    case NextJobAction.SET_REFUND_REQUESTED_INITIATED:
    case NextJobAction.SET_REFUND_REQUESTED_REQUESTED:
    case NextJobAction.UNSET_REFUND_REQUESTED_INITIATED:
    case NextJobAction.UNSET_REFUND_REQUESTED_REQUESTED:
      return SokosumiJobStatus.REFUND_PENDING;
    case NextJobAction.WITHDRAW_REFUND_REQUESTED:
    case NextJobAction.WITHDRAW_REFUND_INITIATED:
    case NextJobAction.AUTHORIZE_WITHDRAWAL_REQUESTED:
    case NextJobAction.AUTHORIZE_WITHDRAWAL_INITIATED:
    case NextJobAction.WAITING_FOR_MANUAL_ACTION:
    case NextJobAction.WAITING_FOR_EXTERNAL_ACTION:
    case NextJobAction.NONE:
    case NextJobAction.IGNORE:
    case null:
      return null;
  }
}

/**
 * Determines the job status when the on-chain status is FUNDS_LOCKED.
 *
 * This function evaluates the agent's job status and relevant job timestamps to derive the most accurate
 * status for a job whose funds have been locked on-chain. The logic prioritizes agent-reported statuses,
 * but also considers timeouts and unlock times for fallback states.
 *
 * Status resolution order:
 * 1. If the agent status is AWAITING_INPUT, return INPUT_REQUIRED.
 * 2. If the agent status is COMPLETED, return COMPLETED.
 * 3. If the agent status is FAILED, return FAILED.
 * 4. If none of the above, check for time-based failure or output pending:
 *    - If `externalDisputeUnlockTime` is set and has passed (with a 10-minute grace period), return FAILED.
 *    - If `submitResultTime` is set and has passed (with a 10-minute grace period), return RESULT_PENDING.
 * 5. If none of the above, return PROCESSING.
 *
 * @param job - The job object containing relevant timestamps and metadata.
 * @param agentJobStatus - The current status reported by the agent, or null if unavailable.
 * @param now - The current date/time for comparison.
 * @returns The resolved JobStatus for the FUNDS_LOCKED state.
 */
function getFundsLockedJobStatus(
  job: Pick<Job, "externalDisputeUnlockTime" | "submitResultTime">,
  latestJobEvent: JobEventForStatusCompute,
  now: Date,
): SokosumiJobStatus {
  switch (latestJobEvent.status) {
    case AgentJobStatus.INITIATED:
    case AgentJobStatus.AWAITING_PAYMENT:
      return SokosumiJobStatus.PAYMENT_PENDING;
    case AgentJobStatus.AWAITING_INPUT:
      if (latestJobEvent.input === null) {
        return SokosumiJobStatus.INPUT_REQUIRED;
      } else {
        return SokosumiJobStatus.PROCESSING;
      }
    case AgentJobStatus.COMPLETED:
      return SokosumiJobStatus.COMPLETED;
    case AgentJobStatus.FAILED:
      return SokosumiJobStatus.FAILED;
    default:
      // Check for FAILED status first (highest priority)
      if (
        job.externalDisputeUnlockTime &&
        job.externalDisputeUnlockTime.getTime() <
          now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return SokosumiJobStatus.FAILED;
      }

      // Check for RESULT_PENDING status (after submit result time with 10min grace period)
      if (
        job.submitResultTime &&
        job.submitResultTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return SokosumiJobStatus.RESULT_PENDING;
      }

      return SokosumiJobStatus.PROCESSING;
  }
}

/**
 * Computes the overall status of a job by combining on-chain status, agent-reported status,
 * and internal error/next-action state. This function is the authoritative source for determining
 * the current lifecycle state of a job, and is used throughout the application for UI and logic.
 *
 * The resolution order is as follows:
 * 1. If the job has been refunded (`refundedTransactionId` is set), return REFUND_RESOLVED.
 * 2. If the job has not started (no purchase), return a payment-related status (see `checkPaymentStatus`).
 * 3. If the job has a next action, return the corresponding status (see `checkNextAction`).
 * 4. Otherwise, resolve based on the on-chain status and agent status:
 *    - null: return PAYMENT_PENDING while the purchase remains unresolved on-chain.
 *    - FUNDS_LOCKED: Use `getFundsLockedJobStatus` for further resolution.
 *    - RESULT_SUBMITTED / WITHDRAW_AUTHORIZED (withdrawal authorized but not
 *      yet executed): If agent completed, return COMPLETED; else RESULT_PENDING.
 *    - FUNDS_WITHDRAWN: If agent completed, return COMPLETED; else FAILED.
 *    - FUNDS_OR_DATUM_INVALID: return PAYMENT_FAILED.
 *    - REFUND_REQUESTED / REFUND_AUTHORIZED (refund authorized but not yet
 *      withdrawn): return REFUND_PENDING.
 *    - REFUND_WITHDRAWN: return REFUND_RESOLVED.
 *    - DISPUTED: return DISPUTE_PENDING.
 *    - DISPUTED_WITHDRAWN: return DISPUTE_RESOLVED.
 *
 * @param job - The job object containing all relevant status and metadata.
 * @returns The resolved JobStatus for the job.
 */
export function computeJobStatus(job: JobForStatusCompute): SokosumiJobStatus {
  switch (job.jobType) {
    case JobType.FREE:
      return computeFreeJobStatus(job);
    case JobType.PAID:
      return computePaidJobStatus(job);
    default: {
      const _exhaustive: never = job.jobType;
      throw new Error(`Unhandled job type: ${_exhaustive}`);
    }
  }
}

function computeFreeJobStatus(job: JobForStatusCompute): SokosumiJobStatus {
  const latestJobEvent = getLatestJobEvent(job);
  if (!latestJobEvent) {
    return SokosumiJobStatus.STARTED;
  }
  switch (latestJobEvent.status) {
    case AgentJobStatus.INITIATED:
      return SokosumiJobStatus.PROCESSING;
    case AgentJobStatus.AWAITING_PAYMENT:
      return SokosumiJobStatus.FAILED;
    case AgentJobStatus.AWAITING_INPUT:
      if (latestJobEvent.input === null) {
        return SokosumiJobStatus.INPUT_REQUIRED;
      } else {
        return SokosumiJobStatus.PROCESSING;
      }
    case AgentJobStatus.COMPLETED:
      return SokosumiJobStatus.COMPLETED;
    case AgentJobStatus.FAILED:
      return SokosumiJobStatus.FAILED;
    case AgentJobStatus.RUNNING:
      return SokosumiJobStatus.PROCESSING;
    default:
      return SokosumiJobStatus.FAILED;
  }
}

function computePaidJobStatus(job: JobForStatusCompute): SokosumiJobStatus {
  // 1. If the job has already been refunded, return the refund resolved status
  if (job.refundedTransactionId) {
    return SokosumiJobStatus.REFUND_RESOLVED;
  }

  const now = new Date();

  // 3. If the job has no purchase, it means the job is not yet started
  const paymentStatus = checkPaymentStatus(job, now);
  if (paymentStatus) {
    return paymentStatus;
  }

  // 4. If the job has a next action, it means the job is not yet finished
  const nextActionStatus = checkNextAction(job);
  if (nextActionStatus) {
    return nextActionStatus;
  }

  const latestJobEvent = getLatestJobEvent(job);
  if (!latestJobEvent) {
    return SokosumiJobStatus.STARTED;
  }
  // 5. If the job has a purchase, it means the job is started
  switch (job.purchase?.onChainStatus) {
    case null:
    case undefined:
      return SokosumiJobStatus.PAYMENT_PENDING;
    case OnChainJobStatus.FUNDS_LOCKED:
      return getFundsLockedJobStatus(job, latestJobEvent, now);
    case OnChainJobStatus.RESULT_SUBMITTED:
    case OnChainJobStatus.WITHDRAW_AUTHORIZED:
      switch (latestJobEvent.status) {
        case AgentJobStatus.COMPLETED:
          return SokosumiJobStatus.COMPLETED;
        default:
          return SokosumiJobStatus.RESULT_PENDING;
      }
    case OnChainJobStatus.FUNDS_WITHDRAWN:
      switch (latestJobEvent.status) {
        case AgentJobStatus.COMPLETED:
          return SokosumiJobStatus.COMPLETED;
        default:
          return SokosumiJobStatus.FAILED;
      }
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      return SokosumiJobStatus.PAYMENT_FAILED;
    case OnChainJobStatus.REFUND_REQUESTED:
    case OnChainJobStatus.REFUND_AUTHORIZED:
      return SokosumiJobStatus.REFUND_PENDING;
    case OnChainJobStatus.REFUND_WITHDRAWN:
      return SokosumiJobStatus.REFUND_RESOLVED;
    case OnChainJobStatus.DISPUTED:
      return SokosumiJobStatus.DISPUTE_PENDING;
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      return SokosumiJobStatus.DISPUTE_RESOLVED;
  }
}

export function getCompletedEvent(job: {
  events: readonly JobEventForListSummary[];
}): JobEventForListSummary | undefined {
  return job.events.find((event) => event.status === AgentJobStatus.COMPLETED);
}

export function getCompletedAt(job: {
  events: readonly JobEventForListSummary[];
}): Date | null {
  const completedEvent = getCompletedEvent(job);
  return completedEvent?.createdAt ?? null;
}

export function getResult(job: {
  events: readonly JobEventForListSummary[];
}): string | null {
  const completedEvent = getCompletedEvent(job);
  return completedEvent?.result ?? null;
}

export function getInitiatedEvent(
  job: JobWithEvents,
): JobEventWithRelations | undefined {
  const lastEvent = job.events.at(-1);
  if (!lastEvent || lastEvent.status !== AgentJobStatus.INITIATED) {
    return undefined;
  }
  return lastEvent;
}

export function getInput(job: JobWithEvents): string | null {
  const initiatedEvent = getInitiatedEvent(job);
  return initiatedEvent?.input?.input ?? null;
}

export function getInputSchema(job: JobWithEvents): string | null {
  const initiatedEvent = getInitiatedEvent(job);
  return initiatedEvent?.inputSchema ?? null;
}

export function getInputHash(job: JobWithEvents): string | null {
  const initiatedEvent = getInitiatedEvent(job);
  return initiatedEvent?.input?.inputHash ?? null;
}

export function getCredits(job: JobWithTransaction): number {
  const transaction = job.transaction;
  if (!transaction) {
    return 0;
  }
  return Math.abs(convertCentsToCredits(transaction.amount));
}

function getCents(job: JobWithTransaction): bigint {
  const transaction = job.transaction;
  if (!transaction) {
    return BigInt(0);
  }
  return transaction.amount;
}

export function getResultHash(job: JobWithPurchase): string | null {
  return job.purchase?.resultHash ?? null;
}

/**
 * Whether a job's status is considered settled for UI (sidebar dots, Ably).
 * FREE: settled once completed. PAID: settled after external dispute unlock.
 */
export function isJobStatusSettled(
  job: Pick<Job, "jobType" | "externalDisputeUnlockTime">,
  completedAt: Date | null,
  now: Date = new Date(),
): boolean {
  switch (job.jobType) {
    case JobType.FREE:
      return completedAt != null;
    case JobType.PAID:
      return job.externalDisputeUnlockTime != null
        ? now > job.externalDisputeUnlockTime
        : false;
    default: {
      const _exhaustive: never = job.jobType;
      throw new Error(`Unhandled job type: ${_exhaustive}`);
    }
  }
}

export function mapJobWithStatus(
  job: JobWithEvents & JobWithTransaction & JobWithPurchase,
): JobWithSokosumiStatus {
  const completedAt = getCompletedAt(job);
  const jobStatusSettled = isJobStatusSettled(job, completedAt);

  const baseJobWithStatus = {
    ...job,
    input: getInput(job),
    inputSchema: getInputSchema(job),
    inputHash: getInputHash(job),
    status: computeJobStatus(job),
    jobStatusSettled,
    completedAt,
    cents: getCents(job),
    credits: getCredits(job),
    onChainStatus: job.purchase?.onChainStatus ?? null,
    onChainTransactionHash: job.purchase?.onChainTransactionHash ?? null,
    result: getResult(job),
    resultHash: getResultHash(job),
  };

  switch (job.jobType) {
    case JobType.PAID:
      return baseJobWithStatus as PaidJobWithStatus;
    case JobType.FREE:
      return baseJobWithStatus as FreeJobWithStatus;
    default: {
      const _exhaustive: never = job.jobType;
      throw new Error(`Unhandled job type: ${_exhaustive}`);
    }
  }
}

export function isFreeJob(job: Job): job is FreeJobWithStatus {
  return job.jobType === JobType.FREE;
}

export function isPaidJob(job: Job): job is PaidJobWithStatus {
  return job.jobType === JobType.PAID;
}
