import type {
  AgentJobStatus,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
} from "@sokosumi/database";

import type {
  Purchase,
  PurchaseErrorType,
  PurchaseNextAction,
  PurchaseOnChainState,
  PurchaseRequestedAction,
} from "@/lib/clients/masumi-payment.client";
import type { JobStatusValue } from "@/lib/schemas";

/**
 * Job transformation utilities.
 * These functions transform external API data structures to database types.
 */

export function onChainStateToOnChainJobStatus(
  onChainState: PurchaseOnChainState,
): OnChainJobStatus | null {
  switch (onChainState) {
    case null:
      return null;
    case "FundsLocked":
      return "FUNDS_LOCKED" as const;
    case "FundsOrDatumInvalid":
      return "FUNDS_OR_DATUM_INVALID" as const;
    case "ResultSubmitted":
      return "RESULT_SUBMITTED" as const;
    case "RefundRequested":
      return "REFUND_REQUESTED" as const;
    case "Disputed":
      return "DISPUTED" as const;
    case "Withdrawn":
      return "FUNDS_WITHDRAWN" as const;
    case "RefundWithdrawn":
      return "REFUND_WITHDRAWN" as const;
    case "DisputedWithdrawn":
      return "DISPUTED_WITHDRAWN" as const;
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
      return "NONE";
    case "Ignore":
      return "IGNORE";
    case "WaitingForManualAction":
      return "WAITING_FOR_MANUAL_ACTION";
    case "WaitingForExternalAction":
      return "WAITING_FOR_EXTERNAL_ACTION";
    case "FundsLockingRequested":
      return "FUNDS_LOCKING_REQUESTED";
    case "FundsLockingInitiated":
      return "FUNDS_LOCKING_INITIATED";
    case "SetRefundRequestedRequested":
      return "SET_REFUND_REQUESTED_REQUESTED";
    case "SetRefundRequestedInitiated":
      return "SET_REFUND_REQUESTED_INITIATED";
    case "UnSetRefundRequestedRequested":
      return "UNSET_REFUND_REQUESTED_REQUESTED";
    case "UnSetRefundRequestedInitiated":
      return "UNSET_REFUND_REQUESTED_INITIATED";
    case "WithdrawRefundRequested":
      return "WITHDRAW_REFUND_REQUESTED";
    case "WithdrawRefundInitiated":
      return "WITHDRAW_REFUND_INITIATED";
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
      return "NETWORK_ERROR";
    case "InsufficientFunds":
      return "INSUFFICIENT_FUNDS";
    case "Unknown":
      return "UNKNOWN";
    default:
      throw new Error(`Unknown next action error type: ${nextActionErrorType}`);
  }
}

export function jobStatusToAgentJobStatus(
  jobStatus: JobStatusValue,
): AgentJobStatus {
  switch (jobStatus) {
    case "pending":
      return "PENDING";
    case "awaiting_payment":
      return "AWAITING_PAYMENT";
    case "awaiting_input":
      return "AWAITING_INPUT";
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      throw new Error(`Unknown job status: ${jobStatus}`);
  }
}

export function transactionStatusToOnChainTransactionStatus(
  currentTransactionStatus:
    | "Pending"
    | "Confirmed"
    | "FailedViaTimeout"
    | "RolledBack",
): OnChainTransactionStatus {
  switch (currentTransactionStatus) {
    case "Pending":
      return "PENDING";
    case "Confirmed":
      return "COMPLETED";
    case "FailedViaTimeout":
    case "RolledBack":
      return "FAILED";
    default:
      throw new Error(
        `Unknown transaction status: ${currentTransactionStatus}`,
      );
  }
}

/**
 * Transform a Purchase from external API to database update data structure.
 */
export function transformPurchaseToJobUpdate(purchase: Purchase): {
  purchaseId: string;
  onChainStatus: OnChainJobStatus | null;
  inputHash: string | null;
  resultHash: string | null;
  nextAction: NextJobAction;
  nextActionErrorType: NextJobActionErrorType | null;
  nextActionErrorNote: string | null;
  onChainTransactionHash?: string;
  onChainTransactionStatus?: OnChainTransactionStatus;
  resultSubmittedAt?: Date;
} {
  const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
  const nextAction = nextActionToNextJobAction(purchase.NextAction);

  const data: {
    purchaseId: string;
    onChainStatus: OnChainJobStatus | null;
    inputHash: string | null;
    resultHash: string | null;
    nextAction: NextJobAction;
    nextActionErrorType: NextJobActionErrorType | null;
    nextActionErrorNote: string | null;
    onChainTransactionHash?: string;
    onChainTransactionStatus?: OnChainTransactionStatus;
    resultSubmittedAt?: Date;
  } = {
    purchaseId: purchase.id,
    onChainStatus,
    inputHash: purchase.inputHash,
    resultHash: purchase.resultHash,
    nextAction: nextAction.requestedAction,
    nextActionErrorType: nextAction.errorType,
    nextActionErrorNote: nextAction.errorNote,
  };

  if (onChainStatus === "RESULT_SUBMITTED") {
    data.resultSubmittedAt = new Date();
  }

  const transaction = purchase.CurrentTransaction;
  if (transaction) {
    data.onChainTransactionHash = transaction.txHash;
    data.onChainTransactionStatus = transactionStatusToOnChainTransactionStatus(
      transaction.status,
    );
  }

  return data;
}
