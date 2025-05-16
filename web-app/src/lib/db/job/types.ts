import {
  AgentJobStatus,
  Job,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export enum JobErrorNoteKeys {
  StatusMismatch = "Job.StatusMismatch",
  Unknown = "Job.UnknownState",
}

export enum JobStatus {
  COMPLETED = "completed",
  FAILED = "failed",
  PAYMENT_PENDING = "payment_pending",
  PAYMENT_FAILED = "payment_failed",
  PROCESSING = "processing",
  INPUT_REQUIRED = "input_required",
  REFUND_PENDING = "refund_pending",
  REFUND_RESOLVED = "refund_resolved",
  REFUND_FAILED = "refund_failed",
  DISPUTE_PENDING = "dispute_pending",
  DISPUTE_RESOLVED = "dispute_resolved",
}

/**
 * Compute the overall job status by combining the on-chain and agent statuses.
 */
export function computeJobStatus(job: Job): JobStatus {
  const { onChainStatus, agentJobStatus, nextActionErrorType } = job;
  switch (onChainStatus) {
    case null:
      if (nextActionErrorType === null) {
        return JobStatus.PAYMENT_PENDING;
      } else {
        return JobStatus.PAYMENT_FAILED;
      }
    case OnChainJobStatus.FUNDS_LOCKED:
      if (agentJobStatus === AgentJobStatus.AWAITING_INPUT) {
        return JobStatus.INPUT_REQUIRED;
      } else {
        return JobStatus.PROCESSING;
      }
    case OnChainJobStatus.RESULT_SUBMITTED:
      if (agentJobStatus === AgentJobStatus.COMPLETED) {
        return JobStatus.COMPLETED;
      } else {
        return JobStatus.PROCESSING;
      }
    case OnChainJobStatus.FUNDS_WITHDRAWN:
      if (agentJobStatus === AgentJobStatus.COMPLETED) {
        return JobStatus.COMPLETED;
      } else {
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
    default:
      return JobStatus.PROCESSING;
  }
}

export const FinalizedOnChainJobStatuses: OnChainJobStatus[] = [
  OnChainJobStatus.DISPUTED_WITHDRAWN,
  OnChainJobStatus.FUNDS_WITHDRAWN,
  OnChainJobStatus.REFUND_WITHDRAWN,
];

export const FinalizedAgentJobStatuses: AgentJobStatus[] = [
  AgentJobStatus.COMPLETED,
  AgentJobStatus.FAILED,
];

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
    case "NetworkError":
      return NextJobActionErrorType.NETWORK_ERROR;
    case "InsufficientFunds":
      return NextJobActionErrorType.INSUFFICIENT_FUNDS;
    case "Unknown":
      return NextJobActionErrorType.UNKNOWN;
    default:
      return null;
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
