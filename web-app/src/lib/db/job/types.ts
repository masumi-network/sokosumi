import {
  AgentJobStatus,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
  creditTransaction: true,
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
  AGENT_CONNECTION_FAILED = "agent_connection_failed",
  PAYMENT_NODE_CONNECTION_FAILED = "payment_node_connection_failed",
}

/**
 * Compute the overall job status by combining the on-chain and agent statuses.
 */
export function computeJobStatus(job: JobWithRelations): JobStatus {
  const { onChainStatus, agentJobStatus, nextActionErrorType } = job;
  // 1) Awaiting payment if no on-chain status yet
  if (onChainStatus === null) {
    if (nextActionErrorType === null) {
      return JobStatus.PAYMENT_PENDING;
    } else {
      return JobStatus.PAYMENT_FAILED;
    }
  }

  // 3) Processing by agent
  if (
    onChainStatus === OnChainJobStatus.FUNDS_LOCKED &&
    agentJobStatus === AgentJobStatus.RUNNING
  ) {
    return JobStatus.PROCESSING;
  }

  // 4) Agent completed off-chain but result not yet submitted on-chain
  if (
    agentJobStatus === AgentJobStatus.COMPLETED &&
    onChainStatus !== OnChainJobStatus.RESULT_SUBMITTED
  ) {
    return JobStatus.PROCESSING;
  }

  // 5) Fully completed on both sides
  if (
    agentJobStatus === AgentJobStatus.COMPLETED &&
    onChainStatus === OnChainJobStatus.RESULT_SUBMITTED
  ) {
    return JobStatus.COMPLETED;
  }

  // 6) Agent failure before submission
  if (agentJobStatus === AgentJobStatus.FAILED) {
    return JobStatus.FAILED;
  }

  // 7) On-chain refund/dispute flows
  switch (onChainStatus) {
    case OnChainJobStatus.REFUND_REQUESTED:
      return JobStatus.REFUND_PENDING;
    case OnChainJobStatus.REFUND_WITHDRAWN:
      return JobStatus.REFUND_RESOLVED;
    case OnChainJobStatus.DISPUTED:
      return JobStatus.DISPUTE_PENDING;
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      return JobStatus.DISPUTE_RESOLVED;
  }

  // Fallback to processing status
  return JobStatus.PROCESSING;
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
  onChainState:
    | "FundsLocked"
    | "FundsOrDatumInvalid"
    | "ResultSubmitted"
    | "RefundRequested"
    | "Disputed"
    | "Withdrawn"
    | "RefundWithdrawn"
    | "DisputedWithdrawn",
): OnChainJobStatus {
  switch (onChainState) {
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

export function nextActionToNextJobAction(
  nextAction:
    | "None"
    | "Ignore"
    | "WaitingForManualAction"
    | "WaitingForExternalAction"
    | "FundsLockingRequested"
    | "FundsLockingInitiated"
    | "SetRefundRequestedRequested"
    | "SetRefundRequestedInitiated"
    | "UnSetRefundRequestedRequested"
    | "UnSetRefundRequestedInitiated"
    | "WithdrawRefundRequested"
    | "WithdrawRefundInitiated",
): NextJobAction {
  switch (nextAction) {
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
      throw new Error(`Unknown next action: ${nextAction}`);
  }
}

export function nextActionErrorTypeToNextJobActionErrorType(
  nextActionErrorType: "NetworkError" | "InsufficientFunds" | "Unknown",
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
  jobStatus:
    | "pending"
    | "awaiting_payment"
    | "awaiting_input"
    | "running"
    | "completed"
    | "failed",
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
