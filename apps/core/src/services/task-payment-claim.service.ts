import { z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  CreditBucketReferenceType,
  type Prisma,
  TaskPaymentClaimStatus,
} from "@sokosumi/database";
import type { MasumiTaskPurchaseInput } from "@sokosumi/masumi/clients";
import { v4 as uuidv4 } from "uuid";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const MAX_FAILURE_REASON_LENGTH = 2_000;
const PROCESSING_LEASE_MS = 2 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60 * 1_000;
const SYNC_BATCH_SIZE = 10;
export const TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS = 8;

const taskPurchasePayloadSchema = z.object({
  blockchainIdentifier: z.string(),
  agentIdentifier: z.string(),
  sellerVkey: z.string(),
  submitResultTime: z.string(),
  payByTime: z.string(),
  unlockTime: z.string(),
  externalDisputeUnlockTime: z.string(),
  inputHash: z.string(),
  Amounts: z.array(z.object({ amount: z.string(), unit: z.string() })),
  identifierFromPurchaser: z.string(),
  metadata: z.string().optional(),
  paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]).optional(),
  smartContractAddress: z.string().optional(),
  supportedPaymentSourceIndex: z.number().int().optional(),
});

interface CreateTaskPaymentClaimInput {
  network: "Preprod" | "Mainnet";
  blockchainIdentifier: string;
  purchasePayload: MasumiTaskPurchaseInput;
  taskEventId: string;
  transactionId: string;
  tx: {
    taskPaymentClaim: Pick<
      Prisma.TransactionClient["taskPaymentClaim"],
      "create"
    >;
  };
}

interface ProcessTaskPaymentClaimOptions {
  abortSignal?: AbortSignal;
}

interface SyncPendingTaskPaymentClaimsOptions {
  abortSignal?: AbortSignal;
  shouldContinue?: () => boolean;
}

export type TaskPaymentClaimProcessResult =
  | { status: "purchased"; purchaseId: string }
  | { status: "refunded"; reason: string; compensated: boolean }
  | { status: "retry_scheduled"; reason: string }
  | { status: "review_required"; reason: string }
  | { status: "skipped" };

function getRequestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function getRetryAt(attemptCount: number): Date {
  const delayMs = Math.min(
    RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
    RETRY_MAX_MS,
  );
  return new Date(Date.now() + delayMs);
}

function parsePurchasePayload(
  value: Prisma.JsonValue,
): MasumiTaskPurchaseInput {
  return taskPurchasePayloadSchema.parse(value);
}

function serializePurchasePayload(
  input: MasumiTaskPurchaseInput,
): Prisma.InputJsonObject {
  return {
    blockchainIdentifier: input.blockchainIdentifier,
    agentIdentifier: input.agentIdentifier,
    sellerVkey: input.sellerVkey,
    submitResultTime: input.submitResultTime,
    payByTime: input.payByTime,
    unlockTime: input.unlockTime,
    externalDisputeUnlockTime: input.externalDisputeUnlockTime,
    inputHash: input.inputHash,
    Amounts: input.Amounts.map((amount) => ({ ...amount })),
    identifierFromPurchaser: input.identifierFromPurchaser,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.paymentSourceType !== undefined
      ? { paymentSourceType: input.paymentSourceType }
      : {}),
    ...(input.smartContractAddress !== undefined
      ? { smartContractAddress: input.smartContractAddress }
      : {}),
    ...(input.supportedPaymentSourceIndex !== undefined
      ? { supportedPaymentSourceIndex: input.supportedPaymentSourceIndex }
      : {}),
  };
}

/**
 * Claims one seller-provided blockchain identifier in the same transaction as
 * the task credit debit. Network-scoped uniqueness blocks sequential and
 * concurrent request replays before either transaction can commit twice.
 */
export async function createTaskPaymentClaim(
  input: CreateTaskPaymentClaimInput,
): Promise<string> {
  const claim = await input.tx.taskPaymentClaim.create({
    data: {
      network: input.network,
      blockchainIdentifier: input.blockchainIdentifier,
      purchasePayload: serializePurchasePayload(input.purchasePayload),
      taskEventId: input.taskEventId,
      transactionId: input.transactionId,
    },
    select: { id: true },
  });
  return claim.id;
}

export async function markTaskPaymentClaimPurchased(
  claimId: string,
  externalPurchaseId: string,
  processingToken?: string,
): Promise<void> {
  const updated = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      status: TaskPaymentClaimStatus.PENDING,
      ...(processingToken ? { processingToken } : {}),
    },
    data: {
      status: TaskPaymentClaimStatus.PURCHASED,
      externalPurchaseId,
      failureReason: null,
      processingStartedAt: null,
      processingToken: null,
    },
  });
  if (updated.count !== 1) {
    throw new Error(`Task payment claim ${claimId} is no longer pending`);
  }
}

/**
 * Restores a permanently failed task payment's full debit as a non-expiring
 * refund bucket. Claim status and refund transaction commit atomically;
 * repeated calls are no-ops after the first refund.
 */
export async function refundFailedTaskPaymentClaim(
  claimId: string,
  failureReason: string,
  processingToken?: string,
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const claimed = await tx.taskPaymentClaim.updateMany({
      where: {
        id: claimId,
        status: TaskPaymentClaimStatus.PENDING,
        ...(processingToken ? { processingToken } : {}),
      },
      data: {
        status: TaskPaymentClaimStatus.REFUNDED,
        failureReason: failureReason.slice(0, MAX_FAILURE_REASON_LENGTH),
        processingStartedAt: null,
        processingToken: null,
      },
    });

    const claim = await tx.taskPaymentClaim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        status: true,
        transaction: {
          select: {
            amount: true,
            userId: true,
            organizationId: true,
          },
        },
      },
    });
    if (!claim) {
      throw new Error(`Task payment claim ${claimId} not found`);
    }
    if (
      claimed.count === 0 &&
      claim.status === TaskPaymentClaimStatus.REFUNDED
    ) {
      return false;
    }
    if (claimed.count === 0) {
      if (claim.status === TaskPaymentClaimStatus.PURCHASED) {
        throw new Error(`Task payment claim ${claimId} is already purchased`);
      }
      throw new Error(
        `Task payment claim ${claimId} could not be refunded (status ${claim.status}; lease no longer owned)`,
      );
    }

    const refundAmount = claim.transaction.amount * -1n;
    if (refundAmount <= 0n) {
      throw new Error(`Task payment claim ${claimId} has no debit to refund`);
    }

    await tx.taskPaymentClaim.update({
      where: { id: claim.id },
      data: {
        refundTransaction: {
          create: {
            amount: refundAmount,
            user: { connect: { id: claim.transaction.userId } },
            ...(claim.transaction.organizationId
              ? {
                  organization: {
                    connect: { id: claim.transaction.organizationId },
                  },
                }
              : {}),
            sourceCreditBucket: {
              create: {
                amount: refundAmount,
                referenceId: `task-payment:${claim.id}`,
                referenceType: CreditBucketReferenceType.REFUND,
                user: { connect: { id: claim.transaction.userId } },
                // Non-expiring, matching how job refunds compensate
                // (services/job-refund.ts). The debit may have consumed
                // expiring buckets, so this can extend the credits' lifetime —
                // deliberate: a payment Sokosumi failed to place must not cost
                // the user credits that expire before they can be spent again.
                expiresAt: null,
                ...(claim.transaction.organizationId
                  ? {
                      organization: {
                        connect: { id: claim.transaction.organizationId },
                      },
                    }
                  : {}),
              },
            },
          } satisfies Prisma.TransactionCreateInput,
        },
      },
    });
    return true;
  });
}

export interface ReviewedTaskPaymentClaimActionInput {
  claimId: string;
  operatorId: string;
  reason: string;
}

/**
 * Durable, append-only record of an operator decision on a claim.
 *
 * These endpoints move money (`resolve` can refund) or reset recovery state
 * (`retry` clears `failureReason`), so attribution cannot live in a mutable
 * column. Written before the action for `resolve` and after a successful
 * `retry`, so a crash mid-action still leaves the intent recorded.
 */
async function recordTaskPaymentClaimAction(entry: {
  claimId: string;
  action: "resolve" | "retry" | "refund";
  operatorId: string;
  reason: string;
}): Promise<void> {
  await prisma.taskPaymentClaimAction.create({
    data: {
      claimId: entry.claimId,
      action: entry.action,
      operatorId: entry.operatorId,
      reason: entry.reason.slice(0, MAX_FAILURE_REASON_LENGTH),
    },
  });
}

interface AcquireTaskPaymentClaimOptions {
  ignoreSchedule?: boolean;
  requireReview?: boolean;
}

async function acquireTaskPaymentClaim(
  claimId: string,
  options: AcquireTaskPaymentClaimOptions = {},
) {
  const now = new Date();
  const processingToken = uuidv4();
  const leaseExpiredAt = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const acquired = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      network: getEnv().NETWORK,
      status: TaskPaymentClaimStatus.PENDING,
      ...(options.ignoreSchedule ? {} : { nextAttemptAt: { lte: now } }),
      ...(options.requireReview
        ? { reviewRequiredAt: { not: null } }
        : { reviewRequiredAt: null }),
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: leaseExpiredAt } },
      ],
    },
    data: {
      processingToken,
      processingStartedAt: now,
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
    },
  });
  if (acquired.count !== 1) {
    return null;
  }

  return await prisma.taskPaymentClaim.findFirst({
    where: { id: claimId, processingToken },
    select: {
      id: true,
      attemptCount: true,
      purchasePayload: true,
      processingToken: true,
      reviewRequiredAt: true,
    },
  });
}

async function scheduleTaskPaymentClaimRetry(
  claimId: string,
  processingToken: string,
  attemptCount: number,
  reviewRequiredAt: Date | null,
  reason: string,
  requireReview: boolean = false,
): Promise<boolean> {
  const now = new Date();
  const shouldRequireReview =
    requireReview ||
    reviewRequiredAt !== null ||
    attemptCount >= TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS;
  const newlyRequiresReview = shouldRequireReview && reviewRequiredAt === null;
  const released = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      status: TaskPaymentClaimStatus.PENDING,
      processingToken,
    },
    data: {
      failureReason: reason.slice(0, MAX_FAILURE_REASON_LENGTH),
      nextAttemptAt: getRetryAt(attemptCount),
      processingStartedAt: null,
      processingToken: null,
      ...(newlyRequiresReview ? { reviewRequiredAt: now } : {}),
    },
  });
  if (released.count !== 1) {
    throw new Error(`Task payment claim ${claimId} lease is no longer owned`);
  }
  if (newlyRequiresReview) {
    Sentry.captureMessage("Task payment claim requires review", {
      level: "error",
      tags: { error_type: "task_payment_claim_review_required" },
      extra: {
        claimId,
        attemptCount,
        reason: reason.slice(0, MAX_FAILURE_REASON_LENGTH),
      },
    });
  }
  return shouldRequireReview;
}

async function finalizePermanentFailure(
  claimId: string,
  processingToken: string,
  reason: string,
): Promise<TaskPaymentClaimProcessResult> {
  const compensated = await refundFailedTaskPaymentClaim(
    claimId,
    reason,
    processingToken,
  );
  return { status: "refunded", reason, compensated };
}

async function finalizeAmbiguousFailure(
  claim: {
    id: string;
    attemptCount: number;
    reviewRequiredAt: Date | null;
  },
  processingToken: string,
  reason: string,
  requireReview: boolean = false,
): Promise<TaskPaymentClaimProcessResult> {
  const requiresReview = await scheduleTaskPaymentClaimRetry(
    claim.id,
    processingToken,
    claim.attemptCount,
    claim.reviewRequiredAt,
    reason,
    requireReview,
  );
  return {
    status: requiresReview ? "review_required" : "retry_scheduled",
    reason,
  };
}

/**
 * Processes one durable task-payment outbox row. Retries resolve first so a
 * runtime crash after the remote POST cannot create or refund a live purchase.
 */
export async function processTaskPaymentClaim(
  claimId: string,
  options: ProcessTaskPaymentClaimOptions = {},
): Promise<TaskPaymentClaimProcessResult> {
  const claim = await acquireTaskPaymentClaim(claimId);
  if (!claim) {
    return { status: "skipped" };
  }
  const processingToken = claim.processingToken;
  if (!processingToken) {
    throw new Error(`Task payment claim ${claim.id} has no processing token`);
  }

  let payload: MasumiTaskPurchaseInput;
  try {
    payload = parsePurchasePayload(claim.purchasePayload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Stored payload corruption cannot heal through another network retry.
    return await finalizeAmbiguousFailure(claim, processingToken, reason, true);
  }

  const client = paymentClient();

  if (claim.attemptCount > 1) {
    const resolved = await client.resolveMasumiTaskPaymentPurchase(payload, {
      signal: getRequestSignal(options.abortSignal),
    });
    if (resolved.isOk()) {
      await markTaskPaymentClaimPurchased(
        claim.id,
        resolved.value.id,
        processingToken,
      );
      return { status: "purchased", purchaseId: resolved.value.id };
    }
    if (resolved.error.kind === "mismatch") {
      return await finalizePermanentFailure(
        claim.id,
        processingToken,
        resolved.error.message,
      );
    }
    if (resolved.error.kind === "ambiguous") {
      return await finalizeAmbiguousFailure(
        claim,
        processingToken,
        resolved.error.message,
      );
    }
  }

  const created = await client.createPurchaseFromMasumiTaskPayment(payload, {
    signal: getRequestSignal(options.abortSignal),
  });
  if (created.isOk()) {
    await markTaskPaymentClaimPurchased(
      claim.id,
      created.value.id,
      processingToken,
    );
    return { status: "purchased", purchaseId: created.value.id };
  }
  if (created.error.kind === "permanent") {
    return await finalizePermanentFailure(
      claim.id,
      processingToken,
      created.error.message,
    );
  }

  const resolved = await client.resolveMasumiTaskPaymentPurchase(payload, {
    signal: getRequestSignal(options.abortSignal),
  });
  if (resolved.isOk()) {
    await markTaskPaymentClaimPurchased(
      claim.id,
      resolved.value.id,
      processingToken,
    );
    return { status: "purchased", purchaseId: resolved.value.id };
  }
  if (resolved.error.kind === "mismatch") {
    return await finalizePermanentFailure(
      claim.id,
      processingToken,
      resolved.error.message,
    );
  }
  return await finalizeAmbiguousFailure(
    claim,
    processingToken,
    `${created.error.message}; reconciliation: ${resolved.error.message}`,
  );
}

/**
 * Moves a reviewed claim back to the normal retry cadence. Cron remains the
 * single writer that performs the remote POST, preserving lease safety.
 */
export async function retryReviewedTaskPaymentClaim(
  input: ReviewedTaskPaymentClaimActionInput,
): Promise<boolean> {
  const { claimId, operatorId, reason } = input;
  const leaseExpiredAt = new Date(Date.now() - PROCESSING_LEASE_MS);
  const updated = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      network: getEnv().NETWORK,
      status: TaskPaymentClaimStatus.PENDING,
      reviewRequiredAt: { not: null },
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: leaseExpiredAt } },
      ],
    },
    data: {
      // Acquisition increments this to 2, forcing resolve-first before POST.
      attemptCount: 1,
      failureReason: null,
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      processingToken: null,
      reviewRequiredAt: null,
    },
  });
  if (updated.count !== 1) {
    return false;
  }
  // `failureReason` above is cleared by design, so the operator decision would
  // otherwise leave no trace at all once the retry succeeds.
  await recordTaskPaymentClaimAction({
    claimId,
    action: "retry",
    operatorId,
    reason,
  });
  return true;
}

/**
 * Terminal operator recovery for claims whose stored payload cannot be parsed
 * or whose remote state was verified out of band. This path deliberately does
 * not inspect purchasePayload, so corrupted rows can still be compensated.
 */
export async function refundReviewedTaskPaymentClaim(
  input: ReviewedTaskPaymentClaimActionInput,
): Promise<TaskPaymentClaimProcessResult> {
  const claim = await acquireTaskPaymentClaim(input.claimId, {
    ignoreSchedule: true,
    requireReview: true,
  });
  if (!claim) {
    return { status: "skipped" };
  }
  const processingToken = claim.processingToken;
  if (!processingToken) {
    throw new Error(`Task payment claim ${claim.id} has no processing token`);
  }

  await recordTaskPaymentClaimAction({
    claimId: claim.id,
    action: "refund",
    operatorId: input.operatorId,
    reason: input.reason,
  });

  return await finalizePermanentFailure(
    claim.id,
    processingToken,
    `Administrator ${input.operatorId} refunded claim: ${input.reason}`,
  );
}

/**
 * Resolve-only operator recovery. Never creates a second remote purchase:
 * found purchases are attached, authoritative absence/mismatch is refunded,
 * and ambiguous lookup failures remain held for operator review.
 */
export async function resolveReviewedTaskPaymentClaim(
  input: ReviewedTaskPaymentClaimActionInput,
): Promise<TaskPaymentClaimProcessResult> {
  const { claimId, operatorId, reason } = input;
  const claim = await acquireTaskPaymentClaim(claimId, {
    ignoreSchedule: true,
    requireReview: true,
  });
  if (!claim) {
    return { status: "skipped" };
  }
  const processingToken = claim.processingToken;
  if (!processingToken) {
    throw new Error(`Task payment claim ${claim.id} has no processing token`);
  }

  // AFTER acquisition: the audit table is deliberately FK-free (see migration
  // 20260804130000), so nothing stops a row being written for an id that does
  // not exist or for a claim another worker holds. Writing only once the lease
  // is ours keeps the log to decisions that actually took effect. Still before
  // the remote call, so a crash mid-resolve leaves the intent recorded.
  await recordTaskPaymentClaimAction({
    claimId: claim.id,
    action: "resolve",
    operatorId,
    reason,
  });

  let payload: MasumiTaskPurchaseInput;
  try {
    payload = parsePurchasePayload(claim.purchasePayload);
  } catch (error) {
    const parseFailureReason =
      error instanceof Error ? error.message : String(error);
    return await finalizeAmbiguousFailure(
      claim,
      processingToken,
      parseFailureReason,
      true,
    );
  }

  const resolved = await paymentClient().resolveMasumiTaskPaymentPurchase(
    payload,
    { signal: getRequestSignal() },
  );
  if (resolved.isOk()) {
    await markTaskPaymentClaimPurchased(
      claim.id,
      resolved.value.id,
      processingToken,
    );
    return { status: "purchased", purchaseId: resolved.value.id };
  }
  if (
    resolved.error.kind === "not_found" ||
    resolved.error.kind === "mismatch"
  ) {
    return await finalizePermanentFailure(
      claim.id,
      processingToken,
      `Operator resolve confirmed ${resolved.error.kind}: ${resolved.error.message}`,
    );
  }
  return await finalizeAmbiguousFailure(
    claim,
    processingToken,
    resolved.error.message,
    true,
  );
}

/**
 * Backlog depth at which one cron tick can no longer keep up (each tick drains
 * at most SYNC_BATCH_SIZE). Reported so a growing queue of charged-but-unpaid
 * claims surfaces on its own instead of only through individual failures.
 */
const TASK_PAYMENT_CLAIM_BACKLOG_ALERT_THRESHOLD = SYNC_BATCH_SIZE * 5;

/** Reconciles retry-eligible PENDING rows for current deployment network. */
export async function syncPendingTaskPaymentClaims(
  options: SyncPendingTaskPaymentClaimsOptions = {},
): Promise<{ processed: number; eligible: number; reviewRequired: number }> {
  const now = new Date();
  const leaseExpiredAt = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const eligibleWhere: Prisma.TaskPaymentClaimWhereInput = {
    network: getEnv().NETWORK,
    status: TaskPaymentClaimStatus.PENDING,
    reviewRequiredAt: null,
    nextAttemptAt: { lte: now },
    OR: [
      { processingStartedAt: null },
      { processingStartedAt: { lt: leaseExpiredAt } },
    ],
  };
  const [pending, eligible, reviewRequired] = await Promise.all([
    prisma.taskPaymentClaim.findMany({
      where: eligibleWhere,
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: SYNC_BATCH_SIZE,
      select: { id: true },
    }),
    prisma.taskPaymentClaim.count({ where: eligibleWhere }),
    prisma.taskPaymentClaim.count({
      where: {
        network: getEnv().NETWORK,
        status: TaskPaymentClaimStatus.PENDING,
        reviewRequiredAt: { not: null },
      },
    }),
  ]);

  if (eligible > TASK_PAYMENT_CLAIM_BACKLOG_ALERT_THRESHOLD) {
    Sentry.captureMessage("Task payment claim backlog is growing", {
      level: "warning",
      tags: { error_type: "task_payment_claim_backlog" },
      extra: { eligible, reviewRequired, batchSize: SYNC_BATCH_SIZE },
    });
  }

  let processed = 0;
  for (const claim of pending) {
    if (options.abortSignal?.aborted || options.shouldContinue?.() === false) {
      break;
    }
    try {
      await processTaskPaymentClaim(claim.id, {
        abortSignal: options.abortSignal,
      });
      processed += 1;
    } catch (error) {
      // One claim must not take the batch down with it. A throw here (lost
      // lease, a row that stopped being PENDING mid-flight, any database
      // error) leaves `nextAttemptAt` untouched, so the row keeps sorting
      // first and would poison every later tick once its lease expires —
      // starving the claims behind it, each of which is a charged-but-unpaid
      // debit.
      console.error(
        `[sync/task-payment-claims] Failed to process claim ${claim.id}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { error_type: "task_payment_claim_process_failed" },
        extra: { claimId: claim.id },
      });
    }
  }
  return { processed, eligible, reviewRequired };
}
