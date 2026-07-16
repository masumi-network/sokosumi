/**
 * Client-safe domain enums mirroring Prisma schema values.
 *
 * Single source of truth for web and other client bundles. Drift guard tests in
 * `@sokosumi/database` assert these stay aligned with generated Prisma enums.
 */

export const AgentJobStatus = {
  INITIATED: "INITIATED",
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  AWAITING_INPUT: "AWAITING_INPUT",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type AgentJobStatus =
  (typeof AgentJobStatus)[keyof typeof AgentJobStatus];

export const AgentStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  DEREGISTERED: "DEREGISTERED",
  INVALID: "INVALID",
} as const;

export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const BlobStatus = {
  PENDING: "PENDING",
  READY: "READY",
  FAILED: "FAILED",
} as const;

export type BlobStatus = (typeof BlobStatus)[keyof typeof BlobStatus];

export const JobType = {
  FREE: "FREE",
  PAID: "PAID",
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];

export const NoticeKind = {
  LEGAL_TERMS: "LEGAL_TERMS",
  ANNOUNCEMENT: "ANNOUNCEMENT",
} as const;

export type NoticeKind = (typeof NoticeKind)[keyof typeof NoticeKind];

export const OnChainJobStatus = {
  FUNDS_LOCKED: "FUNDS_LOCKED",
  FUNDS_OR_DATUM_INVALID: "FUNDS_OR_DATUM_INVALID",
  FUNDS_WITHDRAWN: "FUNDS_WITHDRAWN",
  RESULT_SUBMITTED: "RESULT_SUBMITTED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUND_WITHDRAWN: "REFUND_WITHDRAWN",
  DISPUTED: "DISPUTED",
  DISPUTED_WITHDRAWN: "DISPUTED_WITHDRAWN",
} as const;

export type OnChainJobStatus =
  (typeof OnChainJobStatus)[keyof typeof OnChainJobStatus];

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

export const PricingType = {
  FIXED: "FIXED",
  FREE: "FREE",
  UNKNOWN: "UNKNOWN",
} as const;

export type PricingType = (typeof PricingType)[keyof typeof PricingType];

export const PaymentType = {
  WEB3_CARDANO_V1: "WEB3_CARDANO_V1",
  NONE: "NONE",
  UNKNOWN: "UNKNOWN",
} as const;

export type PaymentType = (typeof PaymentType)[keyof typeof PaymentType];

export const RiskClassification = {
  MINIMAL: "MINIMAL",
  LIMITED: "LIMITED",
  HIGH: "HIGH",
  UNACCEPTABLE: "UNACCEPTABLE",
} as const;

export type RiskClassification =
  (typeof RiskClassification)[keyof typeof RiskClassification];

export const Channel = {
  SLACK: "SLACK",
  TEAMS: "TEAMS",
  EMAIL: "EMAIL",
  LINEAR: "LINEAR",
  GITHUB: "GITHUB",
  WHATSAPP: "WHATSAPP",
  TELEGRAM: "TELEGRAM",
  SIGNAL: "SIGNAL",
  DISCORD: "DISCORD",
  CHAT: "CHAT",
  MESSENGER: "MESSENGER",
  SOKOSUMI: "SOKOSUMI",
  UNKNOWN: "UNKNOWN",
} as const;

export type Channel = (typeof Channel)[keyof typeof Channel];

export const TaskLinkType = {
  RELATES: "RELATES",
  BLOCKS: "BLOCKS",
  PARENT: "PARENT",
  DUPLICATE: "DUPLICATE",
} as const;

export type TaskLinkType = (typeof TaskLinkType)[keyof typeof TaskLinkType];
