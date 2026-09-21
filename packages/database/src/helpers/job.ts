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
import { JOB_SYNC_PAYMENT_GRACE_MS } from "./job-sync.js";

function hasPaymentWindowExpired(
  job: Pick<Job, "createdAt" | "payByTime">,
  now: Date,
): boolean {
  const paymentDeadline = job.payByTime ?? job.createdAt;
  return paymentDeadline.getTime() < now.getTime() - JOB_SYNC_PAYMENT_GRACE_MS;
}

// Events are ordered createdAt desc, so the latest event is events.at(0).
function getLatestJobEvent(job: {
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
          now.getTime() - JOB_SYNC_PAYMENT_GRACE_MS
      ) {
        return SokosumiJobStatus.FAILED;
      }

      // Check for RESULT_PENDING status (after submit result time with 10min grace period)
      if (
        job.submitResultTime &&
        job.submitResultTime.getTime() <
          now.getTime() - JOB_SYNC_PAYMENT_GRACE_MS
      ) {
        return SokosumiJobStatus.RESULT_PENDING;
      }

      return SokosumiJobStatus.PROCESSING;
  }
}

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

function getCompletedEvent(job: {
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

function getInitiatedEvent(
  job: JobWithEvents,
): JobEventWithRelations | undefined {
  const lastEvent = job.events.at(-1);
  if (!lastEvent || lastEvent.status !== AgentJobStatus.INITIATED) {
    return undefined;
  }
  return lastEvent;
}

function getInput(job: JobWithEvents): string | null {
  const initiatedEvent = getInitiatedEvent(job);
  return initiatedEvent?.input?.input ?? null;
}

function getInputSchema(job: JobWithEvents): string | null {
  const initiatedEvent = getInitiatedEvent(job);
  return initiatedEvent?.inputSchema ?? null;
}

function getInputHash(job: JobWithEvents): string | null {
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
