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
  claimCountMock,
  refundClaimUpdateManyMock,
  claimUpdateManyMock,
  claimUpdateMock,
  createPurchaseMock,
  captureMessageMock,
  captureExceptionMock,
  resolvePurchaseMock,
  prismaTransactionMock,
  claimActionCreateMock,
} = vi.hoisted(() => ({
  claimFindUniqueMock: vi.fn(),
  claimFindFirstMock: vi.fn(),
  claimFindManyMock: vi.fn(),
  claimCountMock: vi.fn(),
  refundClaimUpdateManyMock: vi.fn(),
  claimUpdateManyMock: vi.fn(),
  claimUpdateMock: vi.fn(),
  createPurchaseMock: vi.fn(),
  captureMessageMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  resolvePurchaseMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  claimActionCreateMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureMessage: captureMessageMock,
  captureException: captureExceptionMock,
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
      count: claimCountMock,
    },
    taskPaymentClaimAction: {
      create: claimActionCreateMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

import {
  createTaskPaymentClaim,
  markTaskPaymentClaimPurchased,
  processTaskPaymentClaim,
  refundFailedTaskPaymentClaim,
  refundReviewedTaskPaymentClaim,
  resolveReviewedTaskPaymentClaim,
  retryReviewedTaskPaymentClaim,
  syncPendingTaskPaymentClaims,
  TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS,
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
    expect(refund.user.connect.id).toBe("user-1");
    expect(refund.organization.connect.id).toBe("organization-1");
    expect(refund.sourceCreditBucket.create).toMatchObject({
      amount: 500n,
      referenceId: "task-payment:claim-1",
      referenceType: CreditBucketReferenceType.REFUND,
      expiresAt: null,
      userId: null,
      organizationId: "organization-1",
    });
    expect(refund.sourceCreditBucket.create.user).toBeUndefined();
  });

  it("stamps a personal claim refund bucket with the actor", async () => {
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
    claimUpdateMock.mockResolvedValue(undefined);

    expect(
      await refundFailedTaskPaymentClaim("claim-1", "node rejected request"),
    ).toBe(true);

    const refund =
      claimUpdateMock.mock.calls[0]?.[0].data.refundTransaction.create;
    expect(refund.user.connect.id).toBe("user-1");
    expect(refund.organization).toBeUndefined();
    expect(refund.sourceCreditBucket.create.userId).toBe("user-1");
    expect(refund.sourceCreditBucket.create.organizationId).toBeNull();
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

  it("reports a lost processing lease without calling the claim purchased", async () => {
    refundClaimUpdateManyMock.mockResolvedValue({ count: 0 });
    claimFindUniqueMock.mockResolvedValue({
      id: "claim-1",
      status: TaskPaymentClaimStatus.PENDING,
      transaction: {
        amount: -500n,
        userId: "user-1",
        organizationId: null,
      },
    });

    await expect(
      refundFailedTaskPaymentClaim("claim-1", "worker failed", "lease-1"),
    ).rejects.toThrow(
      "Task payment claim claim-1 could not be refunded (status PENDING; lease no longer owned)",
    );
    expect(claimUpdateMock).not.toHaveBeenCalled();
  });

  it("preserves the purchased-state error when a refund loses the race", async () => {
    refundClaimUpdateManyMock.mockResolvedValue({ count: 0 });
    claimFindUniqueMock.mockResolvedValue({
      id: "claim-1",
      status: TaskPaymentClaimStatus.PURCHASED,
      transaction: {
        amount: -500n,
        userId: "user-1",
        organizationId: null,
      },
    });

    await expect(
      refundFailedTaskPaymentClaim("claim-1", "worker failed", "lease-1"),
    ).rejects.toThrow("Task payment claim claim-1 is already purchased");
    expect(claimUpdateMock).not.toHaveBeenCalled();
  });

  it("refunds a deterministic node rejection", async () => {
    claimUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: 1,
      purchasePayload,
      processingToken: "lease-1",
      reviewRequiredAt: null,
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
      reviewRequiredAt: null,
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
      reviewRequiredAt: null,
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

  it("escalates an ambiguous claim after the automatic retry threshold", async () => {
    claimUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS,
      purchasePayload,
      processingToken: "lease-review",
      reviewRequiredAt: null,
    });
    resolvePurchaseMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "resolver unavailable" }),
    );

    await expect(processTaskPaymentClaim("claim-1")).resolves.toEqual({
      status: "review_required",
      reason: "resolver unavailable",
    });

    const retryUpdate = claimUpdateManyMock.mock.calls[1]?.[0];
    expect(retryUpdate.data.reviewRequiredAt).toBeInstanceOf(Date);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Task payment claim requires review",
      expect.objectContaining({
        tags: { error_type: "task_payment_claim_review_required" },
        extra: expect.objectContaining({
          claimId: "claim-1",
          attemptCount: TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS,
        }),
      }),
    );
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("escalates a malformed stored payload without a network retry", async () => {
    claimUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: 1,
      purchasePayload: { malformed: true },
      processingToken: "lease-malformed",
      reviewRequiredAt: null,
    });

    await expect(processTaskPaymentClaim("claim-1")).resolves.toMatchObject({
      status: "review_required",
    });
    expect(
      claimUpdateManyMock.mock.calls[1]?.[0].data.reviewRequiredAt,
    ).toBeInstanceOf(Date);
    expect(createPurchaseMock).not.toHaveBeenCalled();
    expect(resolvePurchaseMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
  });

  it("does not automatically reacquire claims requiring review", async () => {
    claimUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await expect(processTaskPaymentClaim("claim-1")).resolves.toEqual({
      status: "skipped",
    });
    expect(claimUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reviewRequiredAt: null }),
      }),
    );
    expect(claimFindFirstMock).not.toHaveBeenCalled();
    expect(resolvePurchaseMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("refunds a reviewed claim only after authoritative absence", async () => {
    claimUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS + 1,
      purchasePayload,
      processingToken: "lease-reviewed",
      reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
    });
    resolvePurchaseMock.mockResolvedValue(
      err({
        kind: "not_found",
        message: "Task purchase not found",
        status: 404,
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

    await expect(
      resolveReviewedTaskPaymentClaim({
        claimId: "claim-1",
        operatorId: "admin-1",
        reason: "Verified out of band",
      }),
    ).resolves.toEqual({
      status: "refunded",
      reason: "Operator resolve confirmed not_found: Task purchase not found",
      compensated: true,
    });
    expect(createPurchaseMock).not.toHaveBeenCalled();
  });

  it("keeps a reviewed claim pending when operator resolution is ambiguous", async () => {
    claimUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS + 1,
      purchasePayload,
      processingToken: "lease-reviewed",
      reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
    });
    resolvePurchaseMock.mockResolvedValue(
      err({ kind: "ambiguous", message: "resolver unavailable" }),
    );

    await expect(
      resolveReviewedTaskPaymentClaim({
        claimId: "claim-1",
        operatorId: "admin-1",
        reason: "Verified out of band",
      }),
    ).resolves.toEqual({
      status: "review_required",
      reason: "resolver unavailable",
    });
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(createPurchaseMock).not.toHaveBeenCalled();
    expect(claimUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStartedAt: null,
          processingToken: null,
        }),
      }),
    );
  });

  it("refunds a reviewed claim without parsing its stored payload", async () => {
    claimUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-1",
      attemptCount: TASK_PAYMENT_CLAIM_REVIEW_ATTEMPTS + 1,
      purchasePayload: { malformed: true },
      processingToken: "lease-reviewed",
      reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
    });
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

    await expect(
      refundReviewedTaskPaymentClaim({
        claimId: "claim-1",
        operatorId: "admin-1",
        reason: "stored payload is corrupt",
      }),
    ).resolves.toEqual({
      status: "refunded",
      reason: "Administrator admin-1 refunded claim: stored payload is corrupt",
      compensated: true,
    });
    expect(claimUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "claim-1",
          network: "Preprod",
          status: TaskPaymentClaimStatus.PENDING,
          reviewRequiredAt: { not: null },
        }),
      }),
    );
    expect(refundClaimUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ processingToken: "lease-reviewed" }),
      }),
    );
    expect(createPurchaseMock).not.toHaveBeenCalled();
    expect(resolvePurchaseMock).not.toHaveBeenCalled();
  });

  it("moves a reviewed claim back to the normal retry queue", async () => {
    claimUpdateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      retryReviewedTaskPaymentClaim({
        claimId: "claim-1",
        operatorId: "admin-1",
        reason: "Node recovered",
      }),
    ).resolves.toBe(true);
    expect(claimUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "claim-1",
          reviewRequiredAt: { not: null },
        }),
        data: expect.objectContaining({
          attemptCount: 1,
          reviewRequiredAt: null,
          processingStartedAt: null,
          processingToken: null,
        }),
      }),
    );
  });

  it("reconciles stale pending claims for the current network", async () => {
    claimFindManyMock.mockResolvedValue([{ id: "claim-stale" }]);
    claimUpdateManyMock.mockResolvedValue({ count: 0 });
    claimCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(syncPendingTaskPaymentClaims()).resolves.toEqual({
      processed: 1,
      eligible: 1,
      reviewRequired: 0,
    });
    expect(claimFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          network: "Preprod",
          status: TaskPaymentClaimStatus.PENDING,
          reviewRequiredAt: null,
        }),
      }),
    );
  });

  it("reports a backlog one cron tick can no longer drain", async () => {
    claimFindManyMock.mockResolvedValue([]);
    claimCountMock.mockResolvedValueOnce(51).mockResolvedValueOnce(3);

    await expect(syncPendingTaskPaymentClaims()).resolves.toEqual({
      processed: 0,
      eligible: 51,
      reviewRequired: 3,
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Task payment claim backlog is growing",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({ eligible: 51, reviewRequired: 3 }),
      }),
    );
  });

  it("keeps draining the batch when acquisition itself throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    claimFindManyMock.mockResolvedValue([
      { id: "claim-boom" },
      { id: "claim-ok" },
    ]);
    claimCountMock.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    // The first acquisition blows up; every later one reports "not mine".
    // Without the per-claim guard the throw would abort the loop and the
    // charged-but-unpaid claims behind it would never be attempted.
    claimUpdateManyMock
      .mockRejectedValueOnce(new Error("connection terminated"))
      .mockResolvedValue({ count: 0 });

    try {
      await expect(syncPendingTaskPaymentClaims()).resolves.toEqual({
        processed: 1,
        eligible: 2,
        reviewRequired: 0,
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    // Nothing is escalated here on purpose: the lease was never acquired, so
    // the row is untouched and the next tick retries it normally.
    const escalation = claimUpdateManyMock.mock.calls.find(
      (call) =>
        (call[0] as { data?: Record<string, unknown> })?.data
          ?.reviewRequiredAt !== undefined,
    );
    expect(escalation).toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { error_type: "task_payment_claim_process_failed" },
        extra: { claimId: "claim-boom" },
      }),
    );
  });

  it("escalates under its own lease token when processing throws after acquisition", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    claimFindManyMock.mockResolvedValue([{ id: "claim-boom" }]);
    claimCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    claimUpdateManyMock.mockResolvedValue({ count: 1 });
    claimFindFirstMock.mockResolvedValue({
      id: "claim-boom",
      attemptCount: 1,
      purchasePayload,
      processingToken: "token-boom",
      reviewRequiredAt: null,
    });
    // Throws rather than returning an Err — the case scheduleTaskPaymentClaimRetry
    // never sees, so nothing would otherwise back the row off.
    createPurchaseMock.mockRejectedValue(new Error("socket hang up"));

    try {
      await syncPendingTaskPaymentClaims();
    } finally {
      consoleErrorSpy.mockRestore();
    }

    const escalation = claimUpdateManyMock.mock.calls.find(
      (call) =>
        (call[0] as { data?: Record<string, unknown> })?.data
          ?.reviewRequiredAt !== undefined,
    );
    expect(escalation).toBeDefined();
    const [escalationArgs] = escalation as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    // Token-scoped: escalating must never clear a lease another worker holds.
    expect(escalationArgs.where).toMatchObject({
      id: "claim-boom",
      processingToken: "token-boom",
    });
    expect(escalationArgs.data).toMatchObject({
      processingStartedAt: null,
      processingToken: null,
    });
  });

  it("stays quiet while the backlog fits inside the retry cadence", async () => {
    claimFindManyMock.mockResolvedValue([]);
    claimCountMock.mockResolvedValueOnce(50).mockResolvedValueOnce(0);

    await syncPendingTaskPaymentClaims();

    expect(captureMessageMock).not.toHaveBeenCalledWith(
      "Task payment claim backlog is growing",
      expect.anything(),
    );
  });
});
