/**
 * Masumi payment-protocol bridge enums for web job transformers.
 *
 * These map Masumi agent API / on-chain purchase shapes to stable string
 * constants. They are **not** Core REST DTO mirrors — OpenAPI/codegen owns
 * web runtime types for Core API responses.
 */

export const OnChainTransactionStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type OnChainTransactionStatus =
  (typeof OnChainTransactionStatus)[keyof typeof OnChainTransactionStatus];

export const NextJobActionErrorType = {
  NETWORK_ERROR: "NETWORK_ERROR",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  UNKNOWN: "UNKNOWN",
} as const;

export type NextJobActionErrorType =
  (typeof NextJobActionErrorType)[keyof typeof NextJobActionErrorType];

export const NextJobAction = {
  NONE: "NONE",
  IGNORE: "IGNORE",
  WAITING_FOR_MANUAL_ACTION: "WAITING_FOR_MANUAL_ACTION",
  WAITING_FOR_EXTERNAL_ACTION: "WAITING_FOR_EXTERNAL_ACTION",
  FUNDS_LOCKING_REQUESTED: "FUNDS_LOCKING_REQUESTED",
  FUNDS_LOCKING_INITIATED: "FUNDS_LOCKING_INITIATED",
  SET_REFUND_REQUESTED_REQUESTED: "SET_REFUND_REQUESTED_REQUESTED",
  SET_REFUND_REQUESTED_INITIATED: "SET_REFUND_REQUESTED_INITIATED",
  UNSET_REFUND_REQUESTED_REQUESTED: "UNSET_REFUND_REQUESTED_REQUESTED",
  UNSET_REFUND_REQUESTED_INITIATED: "UNSET_REFUND_REQUESTED_INITIATED",
  WITHDRAW_REFUND_REQUESTED: "WITHDRAW_REFUND_REQUESTED",
  WITHDRAW_REFUND_INITIATED: "WITHDRAW_REFUND_INITIATED",
} as const;

export type NextJobAction = (typeof NextJobAction)[keyof typeof NextJobAction];
