import * as Sentry from "@sentry/node";
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
  | "WithdrawAuthorized"
  | "RefundAuthorized"
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
  | "WithdrawRefundInitiated"
  | "AuthorizeWithdrawalRequested"
  | "AuthorizeWithdrawalInitiated";

type PurchaseErrorType =
  | null
  | "NetworkError"
  | "InsufficientFunds"
  | "Unknown";

type PurchaseTransactionStatus =
  | "Pending"
  | "Confirmed"
  | "FailedViaTimeout"
  | "FailedViaManualReset"
  | "RolledBack";

/**
 * Compile-time drift guards: if a regenerated payment client widens one of
 * these unions (new payment-node release), the assertions below stop
 * compiling and force the mapping functions to learn the new members.
 */
type AssertExtends<A extends B, B> = A;
type _AssertOnChainStateCovered = AssertExtends<
  Purchase["onChainState"],
  PurchaseOnChainState
>;
type _AssertRequestedActionCovered = AssertExtends<
  Purchase["NextAction"]["requestedAction"],
  PurchaseRequestedAction
>;
type _AssertErrorTypeCovered = AssertExtends<
  NonNullable<Purchase["NextAction"]>["errorType"] | null,
  PurchaseErrorType
>;
type _AssertTransactionStatusCovered = AssertExtends<
  NonNullable<Purchase["CurrentTransaction"]>["status"],
  PurchaseTransactionStatus
>;

/**
 * Unknown enum values coming from the payment node are skipped (the field is
 * omitted from the update, keeping the previously stored value) instead of
 * throwing, so a single unexpected value cannot wedge purchase sync for a job.
 */
function reportUnknownPurchaseValue(kind: string, value: string): undefined {
  const error = new Error(`Unknown purchase ${kind}: ${value}`);
  console.error("[purchase] skipping unknown value", { kind, value });
  Sentry.captureException(error);
  return undefined;
}

function onChainStateToOnChainJobStatus(
  onChainState: string | null,
): OnChainJobStatus | null | undefined {
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
    case "WithdrawAuthorized":
      return OnChainJobStatus.WITHDRAW_AUTHORIZED;
    case "RefundAuthorized":
      return OnChainJobStatus.REFUND_AUTHORIZED;
    case "Withdrawn":
      return OnChainJobStatus.FUNDS_WITHDRAWN;
    case "RefundWithdrawn":
      return OnChainJobStatus.REFUND_WITHDRAWN;
    case "DisputedWithdrawn":
      return OnChainJobStatus.DISPUTED_WITHDRAWN;
    default:
      return reportUnknownPurchaseValue("on-chain state", onChainState);
  }
}

function requestedActionToNextJobAction(
  requestedAction: string,
): NextJobAction | undefined {
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
    case "AuthorizeWithdrawalRequested":
      return NextJobAction.AUTHORIZE_WITHDRAWAL_REQUESTED;
    case "AuthorizeWithdrawalInitiated":
      return NextJobAction.AUTHORIZE_WITHDRAWAL_INITIATED;
    default:
      return reportUnknownPurchaseValue("next action", requestedAction);
  }
}

function nextActionErrorTypeToNextJobActionErrorType(
  nextActionErrorType: string | null,
): NextJobActionErrorType | null | undefined {
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
      return reportUnknownPurchaseValue(
        "next action error type",
        nextActionErrorType,
      );
  }
}

function transactionStatusToOnChainTransactionStatus(
  currentTransactionStatus: string,
): OnChainTransactionStatus | undefined {
  switch (currentTransactionStatus) {
    case "Pending":
      return OnChainTransactionStatus.PENDING;
    case "Confirmed":
      return OnChainTransactionStatus.COMPLETED;
    case "FailedViaTimeout":
    case "FailedViaManualReset":
    case "RolledBack":
      return OnChainTransactionStatus.FAILED;
    default:
      return reportUnknownPurchaseValue(
        "transaction status",
        currentTransactionStatus,
      );
  }
}

interface PurchaseJobUpdate {
  externalId: string;
  onChainStatus?: OnChainJobStatus | null;
  resultHash: string | null;
  nextAction?: NextJobAction;
  nextActionErrorType?: NextJobActionErrorType | null;
  nextActionErrorNote: string | null;
  onChainTransactionHash?: string;
  onChainTransactionStatus?: OnChainTransactionStatus;
}

/**
 * Transform a Purchase from the external API to a database update data
 * structure. Fields whose incoming value is unknown are omitted (undefined),
 * which keeps the previously stored value.
 */
export function transformPurchaseToJobUpdate(
  purchase: Purchase,
): PurchaseJobUpdate {
  const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
  const nextActionData = purchase.NextAction;
  const requestedAction = requestedActionToNextJobAction(
    nextActionData.requestedAction,
  );
  const errorType = nextActionErrorTypeToNextJobActionErrorType(
    nextActionData.errorType,
  );

  const data: PurchaseJobUpdate = {
    externalId: purchase.id,
    resultHash: purchase.resultHash ?? null,
    nextActionErrorNote: nextActionData.errorNote ?? null,
  };

  if (onChainStatus !== undefined) {
    data.onChainStatus = onChainStatus;
  }
  if (requestedAction !== undefined) {
    data.nextAction = requestedAction;
  }
  if (errorType !== undefined) {
    data.nextActionErrorType = errorType;
  }

  const transaction = purchase.CurrentTransaction;
  if (transaction) {
    const transactionStatus = transactionStatusToOnChainTransactionStatus(
      transaction.status,
    );
    if (transactionStatus !== undefined) {
      data.onChainTransactionHash = transaction.txHash ?? undefined;
      data.onChainTransactionStatus = transactionStatus;
    }
  }

  return data;
}
