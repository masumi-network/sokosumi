import {
  CreditBucketReferenceType,
  TaskPaymentClaimStatus,
} from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimFindUniqueMock,
  claimFindFirstMock,
  claimFindManyMock,
  refundClaimUpdateManyMock,
  claimUpdateManyMock,
  claimUpdateMock,
  createPurchaseMock,
  resolvePurchaseMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  claimFindUniqueMock: vi.fn(),
  claimFindFirstMock: vi.fn(),
  claimFindManyMock: vi.fn(),
  refundClaimUpdateManyMock: vi.fn(),
  claimUpdateManyMock: vi.fn(),
  claimUpdateMock: vi.fn(),
  createPurchaseMock: vi.fn(),
  resolvePurchaseMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ NETWORK: "Preprod" }),
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchaseFromMasumiTaskPayment: createPurchaseMock,
    resolveMasumiTaskPaymentPurchase: resolvePurchaseMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskPaymentClaim: {
      updateMany: claimUpdateManyMock,
      findFirst: claimFindFirstMock,
      findMany: claimFindManyMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

import {
  createTaskPaymentClaim,
  markTaskPaymentClaimPurchased,
  processTaskPaymentClaim,
  refundFailedTaskPaymentClaim,
  syncPendingTaskPaymentClaims,
} from "./task-payment-claim.service";

const purchasePayload = {
  blockchainIdentifier: "aa00",
  agentIdentifier: "ab".repeat(28),
  sellerVkey: "cd".repeat(28),
  submitResultTime: "1775681853000",
  payByTime: "1775737949000",
  unlockTime: "1775763149000",
  externalDisputeUnlockTime: "1775784749000",
  inputHash: "ef".repeat(32),
  Amounts: [{ amount: "1000000", unit: "" }],
  identifierFromPurchaser: "aabbccddeeff00",
  paymentSourceType: "Web3CardanoV1" as const,
  metadata: JSON.stringify({ taskId: "task-1", taskEventId: "event-1" }),
};

describe("task payment claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          taskPaymentClaim: {
            findUnique: claimFindUniqueMock,
            updateMany: refundClaimUpdateManyMock,
            update: claimUpdateMock,
          },
        }),
    );
  });

  it("creates the durable claim through the charge transaction", async () => {
    const create = vi.fn().mockResolvedValue({ id: "claim-1" });

    const claimId = await createTaskPaymentClaim({
      network: "Preprod",
      blockchainIdentifier: "chain-1",
      purchasePayload,
      taskEventId: "event-1",
      transactionId: "transaction-1",
      tx: { taskPaymentClaim: { create } },
    });

    expect(claimId).toBe("claim-1");
    expect(create).toHaveBeenCalledWith({
      data: {
        network: "Preprod",
        blockchainIdentifier: "chain-1",
        purchasePayload,
        taskEventId: "event-1",
        transactionId: "transaction-1",
      },
      select: { id: true },
    });
  });

  it("marks a pending claim purchased", async () => {
    claimUpdateManyMock.mockResolvedValue({ count: 1 });

    await markTaskPaymentClaimPurchased("claim-1", "purchase-1");

    expect(claimUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "claim-1", status: TaskPaymentClaimStatus.PENDING },
      data: {
        status: TaskPaymentClaimStatus.PURCHASED,
        externalPurchaseId: "purchase-1",
        failureReason: null,
        processingStartedAt: null,
        processingToken: null,
      },
    });
  });

  it("refunds a failed purchase once into a non-expiring bucket", async () => {
    refundClaimUpdateManyMock.mockResolvedValue({ count: 1 });
    claimFindUniqueMock.mockResolvedValue({
      id: "claim-1",
      status: TaskPaymentClaimStatus.REFUNDED,
      transaction: {
        amount: -500n,
        userId: "user-1",
        organizationId: "organization-1",
      },
    });
    claimUpdateMock.mockResolvedValue(undefined);

    expect(
      await refundFailedTaskPaymentClaim("claim-1", "node rejected request"),
    ).toBe(true);

    expect(refundClaimUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "claim-1", status: TaskPaymentClaimStatus.PENDING },
      data: {
        status: TaskPaymentClaimStatus.REFUNDED,
        failureReason: "node rejected request",
        processingStartedAt: null,
        processingToken: null,
      },
    });
    const update = claimUpdateMock.mock.calls[0]?.[0];
    expect(update.where).toEqual({ id: "claim-1" });
    const refund = update.data.refundTransaction.create;
    expect(refund.amount).toBe(500n);
    expect(refund.organization.connect.id).toBe("organization-1");
    expect(refund.sourceCreditBucket.create).toMatchObject({
      amount: 500n,
      referenceId: "task-payment:claim-1",
      referenceType: CreditBucketReferenceType.REFUND,
      expiresAt: null,
    });
  });

  it("does not refund an already-refunded claim twice", async () => {
    refundClaimUpdateManyMock.mockResolvedValue({ count: 0 });
    claimFindUniqueMock.mockResolvedValue({
      id: "claim-1",
      status: TaskPaymentClaimStatus.REFUNDED,
      transaction: {
        amount: -500n,
        userId: "user-1",
        organizationId: null,
      },
    });

    expect(
      await refundFailedTaskPaymentClaim("claim-1", "duplicate callback"),
    ).toBe(false);
    expect(claimUpdateMock).not.toHaveBeenCalled();
  });

  it("refunds a deterministic node rejection", async () => {
    claimUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: 1,
      purchasePayload,
      processingToken: "lease-1",
    });
    createPurchaseMock.mockResolvedValue(
      err({
        kind: "permanent",
        message: "Failed to create purchase request (status 400)",
        status: 400,
      }),
    );
    refundClaimUpdateManyMock.mockResolvedValue({ count: 1 });
    claimFindUniqueMock.mockResolvedValue({
      id: "claim-1",
      status: TaskPaymentClaimStatus.REFUNDED,
      transaction: {
        amount: -500n,
        userId: "user-1",
        organizationId: null,
      },
    });

    await expect(processTaskPaymentClaim("claim-1")).resolves.toMatchObject({
      status: "refunded",
      compensated: true,
    });
    expect(refundClaimUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ processingToken: "lease-1" }),
      }),
    );
  });

  it("keeps an ambiguous node failure pending for reconciliation", async () => {
    claimUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: 1,
      purchasePayload,
      processingToken: "lease-1",
    });
    createPurchaseMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "network timeout" }),
    );
    resolvePurchaseMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "resolver unavailable" }),
    );

    await expect(processTaskPaymentClaim("claim-1")).resolves.toMatchObject({
      status: "retry_scheduled",
    });
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(claimUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ processingToken: "lease-1" }),
        data: expect.objectContaining({
          processingToken: null,
          processingStartedAt: null,
        }),
      }),
    );
  });

  it("recovers a purchase after a worker crash without posting again", async () => {
    claimUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: 2,
      purchasePayload,
      processingToken: "lease-2",
    });
    resolvePurchaseMock.mockResolvedValue(
      ok({ id: "purchase-existing" } as { id: string }),
    );

    await expect(processTaskPaymentClaim("claim-1")).resolves.toEqual({
      status: "purchased",
      purchaseId: "purchase-existing",
    });
    expect(createPurchaseMock).not.toHaveBeenCalled();
    expect(claimUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ processingToken: "lease-2" }),
        data: expect.objectContaining({
          status: TaskPaymentClaimStatus.PURCHASED,
          externalPurchaseId: "purchase-existing",
        }),
      }),
    );
  });

  it("reconciles stale pending claims for the current network", async () => {
    claimFindManyMock.mockResolvedValue([{ id: "claim-stale" }]);
    claimUpdateManyMock.mockResolvedValue({ count: 0 });

    await expect(syncPendingTaskPaymentClaims()).resolves.toEqual({
      processed: 1,
    });
    expect(claimFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          network: "Preprod",
          status: TaskPaymentClaimStatus.PENDING,
        }),
      }),
    );
  });
});
