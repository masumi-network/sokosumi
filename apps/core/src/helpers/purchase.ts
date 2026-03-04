import {
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
} from "@sokosumi/database";
import type { PostPurchaseResponses } from "@sokosumi/masumi/clients";

type Purchase = PostPurchaseResponses["200"]["data"];

type PurchaseOnChainState =
  | null
  | "FundsLocked"
  | "FundsOrDatumInvalid"
  | "ResultSubmitted"
  | "RefundRequested"
  | "Disputed"
  | "Withdrawn"
  | "RefundWithdrawn"
  | "DisputedWithdrawn";

type PurchaseRequestedAction =
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
  | "WithdrawRefundInitiated";

type PurchaseErrorType =
  | null
  | "NetworkError"
  | "InsufficientFunds"
  | "Unknown";

function onChainStateToOnChainJobStatus(
  onChainState: PurchaseOnChainState,
): OnChainJobStatus | null {
  switch (onChainState) {
    case null:
      return null;
    case "FundsLocked":
      return "FUNDS_LOCKED";
    case "FundsOrDatumInvalid":
      return "FUNDS_OR_DATUM_INVALID";
    case "ResultSubmitted":
      return "RESULT_SUBMITTED";
    case "RefundRequested":
      return "REFUND_REQUESTED";
    case "Disputed":
      return "DISPUTED";
    case "Withdrawn":
      return "FUNDS_WITHDRAWN";
    case "RefundWithdrawn":
      return "REFUND_WITHDRAWN";
    case "DisputedWithdrawn":
      return "DISPUTED_WITHDRAWN";
    default:
      throw new Error(`Unknown on-chain state: ${onChainState}`);
  }
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

function transactionStatusToOnChainTransactionStatus(
  currentTransactionStatus:
    | "Pending"
    | "Confirmed"
    | "FailedViaTimeout"
    | "FailedViaManualReset"
    | "RolledBack",
): OnChainTransactionStatus {
  switch (currentTransactionStatus) {
    case "Pending":
      return "PENDING";
    case "Confirmed":
      return "COMPLETED";
    case "FailedViaTimeout":
    case "FailedViaManualReset":
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
  externalId: string;
  onChainStatus: OnChainJobStatus | null;
  resultHash: string | null;
  nextAction: NextJobAction;
  nextActionErrorType: NextJobActionErrorType | null;
  nextActionErrorNote: string | null;
  onChainTransactionHash?: string;
  onChainTransactionStatus?: OnChainTransactionStatus;
} {
  const onChainStatus = onChainStateToOnChainJobStatus(
    purchase.onChainState as PurchaseOnChainState,
  );
  const nextActionData = purchase.NextAction;
  const requestedAction = requestedActionToNextJobAction(
    nextActionData.requestedAction as PurchaseRequestedAction,
  );
  const errorType = nextActionErrorTypeToNextJobActionErrorType(
    nextActionData.errorType as PurchaseErrorType,
  );

  const data: {
    externalId: string;
    onChainStatus: OnChainJobStatus | null;
    resultHash: string | null;
    nextAction: NextJobAction;
    nextActionErrorType: NextJobActionErrorType | null;
    nextActionErrorNote: string | null;
    onChainTransactionHash?: string;
    onChainTransactionStatus?: OnChainTransactionStatus;
  } = {
    externalId: purchase.id,
    onChainStatus,
    resultHash: purchase.resultHash ?? null,
    nextAction: requestedAction,
    nextActionErrorType: errorType,
    nextActionErrorNote: nextActionData.errorNote ?? null,
  };

  const transaction = purchase.CurrentTransaction;
  if (transaction) {
    data.onChainTransactionHash = transaction.txHash ?? undefined;
    data.onChainTransactionStatus = transactionStatusToOnChainTransactionStatus(
      transaction.status as
        | "Pending"
        | "Confirmed"
        | "FailedViaTimeout"
        | "FailedViaManualReset"
        | "RolledBack",
    );
  }

  return data;
}
