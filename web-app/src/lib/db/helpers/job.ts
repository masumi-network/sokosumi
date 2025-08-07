import { JobIndicatorStatus } from "@/lib/ably";
import { JobStatus } from "@/lib/db/types";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
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

      // Check for OUTPUT_PENDING status (after submit result time with 10min grace period)
      if (
        job.submitResultTime &&
        job.submitResultTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
      ) {
        return JobStatus.OUTPUT_PENDING;
      }

      return JobStatus.PROCESSING;
  }
}

/**
 * Compute the overall job status by combining the on-chain and agent statuses.
 */
export function computeJobStatus(job: Job): JobStatus {
  const { onChainStatus, agentJobStatus, nextActionErrorType } = job;
  // If the job has already been refunded, return the refund resolved status
  if (job.refundedCreditTransactionId) {
    return JobStatus.REFUND_RESOLVED;
  }

  const now = new Date();

  // If the job has no purchase, it means the job is not yet started
  const paymentStatus = checkPaymentStatus(job, now);
  if (paymentStatus) {
    return paymentStatus;
  }

  // If the job has a purchase, it means the job is started
  switch (onChainStatus) {
    case null:
      if (nextActionErrorType) {
        return JobStatus.PAYMENT_FAILED;
      }
      if (
        job.submitResultTime &&
        job.submitResultTime.getTime() < now.getTime() - TEN_MINUTES_TIMESTAMP
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
          return JobStatus.OUTPUT_PENDING;
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
