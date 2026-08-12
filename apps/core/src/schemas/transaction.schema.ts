import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Coarse origin of a transaction row, derived from which relation is
 * populated on the underlying `Transaction` record. `other` covers grant
 * sources not yet broken out individually (subscription/enterprise/seat/
 * signup-bonus credits) — see `mapTransactionRow` in `helpers/transaction-history.ts`.
 */
export const transactionSourceSchema = z
  .enum([
    "job_purchase",
    "job_refund",
    "task_usage",
    "coworker_usage",
    "orchestrator_usage",
    "credit_grant",
    "other",
  ])
  .openapi("TransactionSource");

export const transactionHistoryItemSchema = z
  .object({
    id: z.string().openapi({
      description: "Transaction ID",
      example: "cmi4gmksz000104l8wps8p7fp",
    }),
    createdAt: dateTimeSchema.openapi({
      description: "When the transaction was recorded",
    }),
    credits: z.number().openapi({
      description:
        "Signed credit amount. Positive is a credit grant/top-up, negative is a spend.",
      example: -5,
    }),
    source: transactionSourceSchema.openapi({
      description: "Coarse origin of the transaction",
      example: "job_purchase",
    }),
    jobId: z.string().nullable().openapi({
      description:
        "Associated job ID, when this transaction is a job purchase or refund. Null otherwise.",
      example: "cmi4gmksz000104l8wps8p8fp",
    }),
    agentId: z.string().nullable().openapi({
      description:
        "Agent ID for the associated job, for deep-linking. Null when jobId is null.",
      example: "agent_123",
    }),
  })
  .openapi("TransactionHistoryItem");

export const transactionHistoryListSchema = z
  .array(transactionHistoryItemSchema)
  .openapi("TransactionHistoryList");

export const transactionHistoryListResponseExample = {
  data: [
    {
      id: "cmi4gmksz000104l8wps8p7fp",
      createdAt: "2026-01-15T10:30:00.000Z",
      credits: -5,
      source: "job_purchase",
      jobId: "cmi4gmksz000104l8wps8p8fp",
      agentId: "agent_123",
    },
    {
      id: "cmi4gmksz000104l8wps8p9fp",
      createdAt: "2026-01-10T09:00:00.000Z",
      credits: 1000,
      source: "credit_grant",
      jobId: null,
      agentId: null,
    },
  ],
  meta: {
    timestamp: "2026-01-15T12:00:00.000Z",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    pagination: {
      cursor: null,
      limit: 20,
      total: 2,
      nextCursor: null,
    },
  },
};

export type TransactionHistoryItem = z.infer<
  typeof transactionHistoryItemSchema
>;
