import { convertCentsToCredits } from "@sokosumi/database/helpers";

import {
  AgentJobStatus,
  JobType,
  NextJobAction,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Job, JobStatus } from "../generated/prisma/client.js";
import {
  DemoJobWithStatus,
  FreeJobWithStatus,
  type JobWithRelations,
  type JobWithStatus,
  PaidJobWithStatus,
  SokosumiJobStatus,
} from "../types/job.js";

const TEN_MINUTES_TIMESTAMP = 1000 * 60 * 10; // 10min

function checkPaymentStatus(
  job: JobWithRelations,
  now: Date,
): SokosumiJobStatus | null {
  const purchase = job.purchase;
  if (!purchase) {
    if (job.createdAt.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP) {
      return SokosumiJobStatus.PAYMENT_FAILED;
    } else {
      return SokosumiJobStatus.PAYMENT_PENDING;
    }
  }
  if (purchase.onChainStatus === null && purchase.nextActionErrorType) {
    return SokosumiJobStatus.PAYMENT_FAILED;
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
function checkNextAction(job: JobWithRelations): SokosumiJobStatus | null {
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
  job: Job,
  agentJobStatus: AgentJobStatus,
  now: Date,
): SokosumiJobStatus {
  switch (agentJobStatus) {
    case AgentJobStatus.AWAITING_INPUT:
      return SokosumiJobStatus.INPUT_REQUIRED;
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
 * 1. If the job has been refunded (`refundedCreditTransactionId` is set), return REFUND_RESOLVED.
 * 2. If the job has no on-chain status and there is a next action error, return PAYMENT_FAILED.
 * 3. If the job has not started (no purchase), return a payment-related status (see `checkPaymentStatus`).
 * 4. If the job has a next action, return the corresponding status (see `checkNextAction`).
 * 5. Otherwise, resolve based on the on-chain status and agent status:
 *    - null: If `payByTime` expired (with grace), return FAILED; else PAYMENT_PENDING.
 *    - FUNDS_LOCKED: Use `getFundsLockedJobStatus` for further resolution.
 *    - RESULT_SUBMITTED: If agent completed, return COMPLETED; else RESULT_PENDING.
 *    - FUNDS_WITHDRAWN: If agent completed, return COMPLETED; else FAILED.
 *    - FUNDS_OR_DATUM_INVALID: return PAYMENT_FAILED.
 *    - REFUND_REQUESTED: return REFUND_PENDING.
 *    - REFUND_WITHDRAWN: return REFUND_RESOLVED.
 *    - DISPUTED: return DISPUTE_PENDING.
 *    - DISPUTED_WITHDRAWN: return DISPUTE_RESOLVED.
 *
 * @param job - The job object containing all relevant status and metadata.
 * @returns The resolved JobStatus for the job.
 */
export function computeJobStatus(job: JobWithRelations): SokosumiJobStatus {
  switch (job.jobType) {
    case JobType.FREE:
      return computeFreeJobStatus(job);
    case JobType.PAID:
      return computePaidJobStatus(job);
    case JobType.DEMO:
      return computeDemoJobStatus(job);
  }
}

function computeFreeJobStatus(job: JobWithRelations): SokosumiJobStatus {
  if (job.statuses.length === 0) {
    return SokosumiJobStatus.PAYMENT_PENDING;
  }
  const latestJobStatus = job.statuses.at(0);
  if (!latestJobStatus) {
    return SokosumiJobStatus.FAILED;
  }
  switch (latestJobStatus.status) {
    case AgentJobStatus.AWAITING_PAYMENT:
      return SokosumiJobStatus.FAILED;
    case AgentJobStatus.AWAITING_INPUT:
      return SokosumiJobStatus.INPUT_REQUIRED;
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

function computeDemoJobStatus(_job: JobWithRelations): SokosumiJobStatus {
  return SokosumiJobStatus.COMPLETED;
}

function computePaidJobStatus(job: JobWithRelations): SokosumiJobStatus {
  // 1. If the job has already been refunded, return the refund resolved status
  if (job.refundedCreditTransactionId) {
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

  const latestJobStatus = job.statuses.at(0);
  if (!latestJobStatus) {
    return SokosumiJobStatus.FAILED;
  }
  // 5. If the job has a purchase, it means the job is started
  switch (job.purchase?.onChainStatus) {
    case null:
    case undefined:
      if (
        job.payByTime &&
        job.payByTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return SokosumiJobStatus.FAILED;
      }
      return SokosumiJobStatus.PAYMENT_PENDING;
    case OnChainJobStatus.FUNDS_LOCKED:
      return getFundsLockedJobStatus(job, latestJobStatus.status, now);
    case OnChainJobStatus.RESULT_SUBMITTED:
      switch (latestJobStatus.status) {
        case AgentJobStatus.COMPLETED:
          return SokosumiJobStatus.COMPLETED;
        default:
          return SokosumiJobStatus.RESULT_PENDING;
      }
    case OnChainJobStatus.FUNDS_WITHDRAWN:
      switch (latestJobStatus.status) {
        case AgentJobStatus.COMPLETED:
          return SokosumiJobStatus.COMPLETED;
        default:
          return SokosumiJobStatus.FAILED;
      }
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      return SokosumiJobStatus.PAYMENT_FAILED;
    case OnChainJobStatus.REFUND_REQUESTED:
      return SokosumiJobStatus.REFUND_PENDING;
    case OnChainJobStatus.REFUND_WITHDRAWN:
      return SokosumiJobStatus.REFUND_RESOLVED;
    case OnChainJobStatus.DISPUTED:
      return SokosumiJobStatus.DISPUTE_PENDING;
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      return SokosumiJobStatus.DISPUTE_RESOLVED;
  }
}

export function mapJobWithStatus(job: JobWithRelations): JobWithStatus {
  const completedStatus = job.statuses.find(
    (event: JobStatus) => event.status === AgentJobStatus.COMPLETED,
  );
  const completedAt = completedStatus?.createdAt ?? null;
  const result = completedStatus?.result ?? null;

  const jobInput = job.inputs.at(0) ?? null;
  const input = jobInput?.input ?? null;
  const inputSchema = jobInput?.inputSchema ?? null;
  const inputHash = jobInput?.inputHash ?? null;

  const jobStatusSettled =
    job.jobType === JobType.PAID
      ? job.externalDisputeUnlockTime != null
        ? new Date() > job.externalDisputeUnlockTime
        : false
      : completedAt != null;

  const baseJobWithStatus = {
    ...job,
    status: computeJobStatus(job),
    jobStatusSettled,
    completedAt: completedAt ?? null,
    result: result ?? null,
    input: input ?? null,
    inputHash: inputHash ?? null,
    inputSchema: inputSchema ?? null,
    cents: job.creditTransaction?.amount ?? BigInt(0),
    credits: Math.abs(
      convertCentsToCredits(job.creditTransaction?.amount ?? BigInt(0)),
    ),
    resultHash: job.purchase?.resultHash ?? null,
  };

  switch (job.jobType) {
    case JobType.PAID:
      return baseJobWithStatus as PaidJobWithStatus;
    case JobType.FREE:
      return baseJobWithStatus as FreeJobWithStatus;
    case JobType.DEMO:
      return baseJobWithStatus as DemoJobWithStatus;
    default: {
      const _exhaustive: never = job.jobType;
      throw new Error(`Unhandled job type: ${_exhaustive}`);
    }
  }
}

export function isFreeJob(job: JobWithStatus): job is FreeJobWithStatus {
  return job.jobType === JobType.FREE;
}

export function isPaidJob(job: JobWithStatus): job is PaidJobWithStatus {
  return job.jobType === JobType.PAID;
}

export function isDemoJob(job: JobWithStatus): job is DemoJobWithStatus {
  return job.jobType === JobType.DEMO;
}
