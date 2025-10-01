import { JobIndicatorStatus } from "@/lib/ably";
import { JobStatus, JobWithRelations } from "@/lib/db/types";
import {
  AgentJobStatus,
  Job,
  JobShare,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
  ShareAccessType,
} from "@/prisma/generated/client";

const TEN_MINUTES_TIMESTAMP = 1000 * 60 * 10; // 10min

function checkPaymentStatus(job: Job, now: Date): JobStatus | null {
  if (job.purchaseId === null) {
    if (job.createdAt.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP) {
      return JobStatus.PAYMENT_FAILED;
    } else {
      return JobStatus.PAYMENT_PENDING;
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
function checkNextAction(job: Job): JobStatus | null {
  switch (job.nextAction) {
    case NextJobAction.FUNDS_LOCKING_INITIATED:
    case NextJobAction.FUNDS_LOCKING_REQUESTED:
      return JobStatus.PAYMENT_PENDING;
    case NextJobAction.SET_REFUND_REQUESTED_INITIATED:
    case NextJobAction.SET_REFUND_REQUESTED_REQUESTED:
    case NextJobAction.UNSET_REFUND_REQUESTED_INITIATED:
    case NextJobAction.UNSET_REFUND_REQUESTED_REQUESTED:
      return JobStatus.REFUND_PENDING;
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
  agentJobStatus: AgentJobStatus | null,
  now: Date,
): JobStatus {
  switch (agentJobStatus) {
    case AgentJobStatus.AWAITING_INPUT:
      return JobStatus.INPUT_REQUIRED;
    case AgentJobStatus.COMPLETED:
      return JobStatus.COMPLETED;
    case AgentJobStatus.FAILED:
      return JobStatus.FAILED;
    default:
      // Check for FAILED status first (highest priority)
      if (
        job.externalDisputeUnlockTime &&
        job.externalDisputeUnlockTime.getTime() <
          now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return JobStatus.FAILED;
      }

      // Check for RESULT_PENDING status (after submit result time with 10min grace period)
      if (
        job.submitResultTime &&
        job.submitResultTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return JobStatus.RESULT_PENDING;
      }

      return JobStatus.PROCESSING;
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
export function computeJobStatus(job: Job): JobStatus {
  const { onChainStatus, agentJobStatus, nextActionErrorType } = job;

  // 1. If the job has already been refunded, return the refund resolved status
  if (job.refundedCreditTransactionId) {
    return JobStatus.REFUND_RESOLVED;
  }

  // 2. If the job has no on-chain status and there is an error type, it means the job is failed
  if (job.onChainStatus === null && nextActionErrorType) {
    return JobStatus.PAYMENT_FAILED;
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

  // 5. If the job has a purchase, it means the job is started
  switch (onChainStatus) {
    case null:
      if (
        job.payByTime &&
        job.payByTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return JobStatus.FAILED;
      }
      return JobStatus.PAYMENT_PENDING;
    case OnChainJobStatus.FUNDS_LOCKED:
      return getFundsLockedJobStatus(job, agentJobStatus, now);
    case OnChainJobStatus.RESULT_SUBMITTED:
      switch (agentJobStatus) {
        case AgentJobStatus.COMPLETED:
          return JobStatus.COMPLETED;
        default:
          return JobStatus.RESULT_PENDING;
      }
    case OnChainJobStatus.FUNDS_WITHDRAWN:
      switch (agentJobStatus) {
        case AgentJobStatus.COMPLETED:
          return JobStatus.COMPLETED;
        default:
          return JobStatus.FAILED;
      }
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      return JobStatus.PAYMENT_FAILED;
    case OnChainJobStatus.REFUND_REQUESTED:
      return JobStatus.REFUND_PENDING;
    case OnChainJobStatus.REFUND_WITHDRAWN:
      return JobStatus.REFUND_RESOLVED;
    case OnChainJobStatus.DISPUTED:
      return JobStatus.DISPUTE_PENDING;
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      return JobStatus.DISPUTE_RESOLVED;
  }
}

/**
 * Get the job status data for the job which is used on sidebar job status indicator
 * and used by ably to update the job status in real time.
 * @param job - The job to get the status data for.
 * @returns The job status data.
 */
export function getJobIndicatorStatus(job: Job): JobIndicatorStatus {
  return {
    jobId: job.id,
    jobStatus: computeJobStatus(job),
    jobStatusSettled: new Date() > job.externalDisputeUnlockTime,
  };
}

export function onChainStateToOnChainJobStatus(
  onChainState: PurchaseOnChainState,
): OnChainJobStatus | null {
  switch (onChainState) {
    case null:
      return null;
    case "FundsLocked":
      return OnChainJobStatus.FUNDS_LOCKED;
    case "FundsOrDatumInvalid":
      return OnChainJobStatus.FUNDS_OR_DATUM_INVALID;
    case "ResultSubmitted":
      return OnChainJobStatus.RESULT_SUBMITTED;
    case "RefundRequested":
      return OnChainJobStatus.REFUND_REQUESTED;
    case "Disputed":
      return OnChainJobStatus.DISPUTED;
    case "Withdrawn":
      return OnChainJobStatus.FUNDS_WITHDRAWN;
    case "RefundWithdrawn":
      return OnChainJobStatus.REFUND_WITHDRAWN;
    case "DisputedWithdrawn":
      return OnChainJobStatus.DISPUTED_WITHDRAWN;
    default:
      throw new Error(`Unknown on-chain state: ${onChainState}`);
  }
}

export function nextActionToNextJobAction(nextAction: PurchaseNextAction): {
  requestedAction: NextJobAction;
  errorType: NextJobActionErrorType | null;
  errorNote: string | null;
} {
  const requestedAction = requestedActionToNextJobAction(
    nextAction.requestedAction,
  );
  const errorType = nextActionErrorTypeToNextJobActionErrorType(
    nextAction.errorType,
  );
  return {
    requestedAction,
    errorType,
    errorNote: nextAction.errorNote,
  };
}

function requestedActionToNextJobAction(
  requestedAction: PurchaseRequestedAction,
): NextJobAction {
  switch (requestedAction) {
    case "None":
      return NextJobAction.NONE;
    case "Ignore":
      return NextJobAction.IGNORE;
    case "WaitingForManualAction":
      return NextJobAction.WAITING_FOR_MANUAL_ACTION;
    case "WaitingForExternalAction":
      return NextJobAction.WAITING_FOR_EXTERNAL_ACTION;
    case "FundsLockingRequested":
      return NextJobAction.FUNDS_LOCKING_REQUESTED;
    case "FundsLockingInitiated":
      return NextJobAction.FUNDS_LOCKING_INITIATED;
    case "SetRefundRequestedRequested":
      return NextJobAction.SET_REFUND_REQUESTED_REQUESTED;
    case "SetRefundRequestedInitiated":
      return NextJobAction.SET_REFUND_REQUESTED_INITIATED;
    case "UnSetRefundRequestedRequested":
      return NextJobAction.UNSET_REFUND_REQUESTED_REQUESTED;
    case "UnSetRefundRequestedInitiated":
      return NextJobAction.UNSET_REFUND_REQUESTED_INITIATED;
    case "WithdrawRefundRequested":
      return NextJobAction.WITHDRAW_REFUND_REQUESTED;
    case "WithdrawRefundInitiated":
      return NextJobAction.WITHDRAW_REFUND_INITIATED;
    default:
      throw new Error(`Unknown next action: ${requestedAction}`);
  }
}

function nextActionErrorTypeToNextJobActionErrorType(
  nextActionErrorType: PurchaseErrorType,
): NextJobActionErrorType | null {
  switch (nextActionErrorType) {
    case null:
      return null;
    case "NetworkError":
      return NextJobActionErrorType.NETWORK_ERROR;
    case "InsufficientFunds":
      return NextJobActionErrorType.INSUFFICIENT_FUNDS;
    case "Unknown":
      return NextJobActionErrorType.UNKNOWN;
    default:
      throw new Error(`Unknown next action error type: ${nextActionErrorType}`);
  }
}

export function jobStatusToAgentJobStatus(
  jobStatus: JobStatusResponse,
): AgentJobStatus {
  switch (jobStatus) {
    case "pending":
      return AgentJobStatus.PENDING;
    case "awaiting_payment":
      return AgentJobStatus.AWAITING_PAYMENT;
    case "awaiting_input":
      return AgentJobStatus.AWAITING_INPUT;
    case "running":
      return AgentJobStatus.RUNNING;
    case "completed":
      return AgentJobStatus.COMPLETED;
    case "failed":
      return AgentJobStatus.FAILED;
    default:
      throw new Error(`Unknown job status: ${jobStatus}`);
  }
}

export function transactionStatusToOnChainTransactionStatus(
  currentTransactionStatus: CurrentTransactionStatus,
): OnChainTransactionStatus {
  switch (currentTransactionStatus) {
    case "Pending":
      return OnChainTransactionStatus.PENDING;
    case "Confirmed":
      return OnChainTransactionStatus.COMPLETED;
    case "FailedViaTimeout":
      return OnChainTransactionStatus.FAILED;
    default:
      throw new Error(
        `Unknown transaction status: ${currentTransactionStatus}`,
      );
  }
}

export function isPubliclyShared(job: JobWithRelations): boolean {
  return job.shares.some(
    (share) => share.accessType === ShareAccessType.PUBLIC,
  );
}

export function isOrganizationShared(job: JobWithRelations): boolean {
  return job.shares.some((share) => share.recipientOrganizationId !== null);
}

export function getPublicJobShare(job: JobWithRelations): JobShare | null {
  const found = job.shares.find(
    (share) => share.accessType === ShareAccessType.PUBLIC,
  );
  return found ?? null;
}

export function getOrganizationJobShare(
  job: JobWithRelations,
  organizationId: string,
): JobShare | null {
  const found = job.shares.find(
    (share) => share.recipientOrganizationId === organizationId,
  );
  return found ?? null;
}

export function isSharedWithOrganization(
  job: JobWithRelations,
  organizationId: string,
): boolean {
  return job.shares.some(
    (share) => share.recipientOrganizationId === organizationId,
  );
}
