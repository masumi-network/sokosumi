import { z } from "@hono/zod-openapi";
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
      throw new Error(`Task payment claim ${claimId} is already purchased`);
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

async function acquireTaskPaymentClaim(claimId: string) {
  const now = new Date();
  const processingToken = uuidv4();
  const leaseExpiredAt = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const acquired = await prisma.taskPaymentClaim.updateMany({
    where: {
      id: claimId,
      network: getEnv().NETWORK,
      status: TaskPaymentClaimStatus.PENDING,
      nextAttemptAt: { lte: now },
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
    },
  });
}

async function scheduleTaskPaymentClaimRetry(
  claimId: string,
  processingToken: string,
  attemptCount: number,
  reason: string,
): Promise<void> {
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
    },
  });
  if (released.count !== 1) {
    throw new Error(`Task payment claim ${claimId} lease is no longer owned`);
  }
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
  },
  processingToken: string,
  reason: string,
): Promise<TaskPaymentClaimProcessResult> {
  await scheduleTaskPaymentClaimRetry(
    claim.id,
    processingToken,
    claim.attemptCount,
    reason,
  );
  return { status: "retry_scheduled", reason };
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
    return await finalizeAmbiguousFailure(claim, processingToken, reason);
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

/** Reconciles fresh and stale PENDING rows for current deployment network. */
export async function syncPendingTaskPaymentClaims(
  options: SyncPendingTaskPaymentClaimsOptions = {},
): Promise<{ processed: number }> {
  const now = new Date();
  const leaseExpiredAt = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const pending = await prisma.taskPaymentClaim.findMany({
    where: {
      network: getEnv().NETWORK,
      status: TaskPaymentClaimStatus.PENDING,
      nextAttemptAt: { lte: now },
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: leaseExpiredAt } },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: SYNC_BATCH_SIZE,
    select: { id: true },
  });

  let processed = 0;
  for (const claim of pending) {
    if (options.abortSignal?.aborted || options.shouldContinue?.() === false) {
      break;
    }
    await processTaskPaymentClaim(claim.id, {
      abortSignal: options.abortSignal,
    });
    processed += 1;
  }
  return { processed };
}
