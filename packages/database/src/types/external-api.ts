/**
 * External API type interfaces.
 * These types represent data structures from external payment and job status APIs.
 * These are plain JavaScript object shapes that can be used in a future schema package.
 */

export type PurchaseOnChainState =
  | null
  | "FundsLocked"
  | "FundsOrDatumInvalid"
  | "ResultSubmitted"
  | "RefundRequested"
  | "Disputed"
  | "Withdrawn"
  | "RefundWithdrawn"
  | "DisputedWithdrawn";

export type PurchaseRequestedAction =
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

export type PurchaseErrorType =
  | "NetworkError"
  | "InsufficientFunds"
  | "Unknown"
  | null;

export interface PurchaseNextAction {
  requestedAction: PurchaseRequestedAction;
  errorType: PurchaseErrorType;
  errorNote: string | null;
}

export interface PurchaseCurrentTransaction {
  txHash: string;
  status: "Pending" | "Confirmed" | "FailedViaTimeout" | "RolledBack";
}

export interface Purchase {
  id: string;
  onChainState: PurchaseOnChainState;
  inputHash: string | null;
  resultHash: string | null;
  NextAction: PurchaseNextAction;
  CurrentTransaction: PurchaseCurrentTransaction | null;
}

export type JobStatusResponse =
  | "pending"
  | "awaiting_payment"
  | "awaiting_input"
  | "running"
  | "completed"
  | "failed";

export interface CreditsPrice {
  cents: bigint;
  includedFee: bigint;
}

