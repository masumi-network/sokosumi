import {
  CreditBucketReferenceType,
  TaskPaymentClaimStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimFindUniqueMock,
  refundClaimUpdateManyMock,
  claimUpdateManyMock,
  claimUpdateMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  claimFindUniqueMock: vi.fn(),
  refundClaimUpdateManyMock: vi.fn(),
  claimUpdateManyMock: vi.fn(),
  claimUpdateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskPaymentClaim: {
      updateMany: claimUpdateManyMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

import {
  createTaskPaymentClaim,
  markTaskPaymentClaimPurchased,
  refundFailedTaskPaymentClaim,
} from "./task-payment-claim.service";

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
      blockchainIdentifier: "chain-1",
      taskEventId: "event-1",
      transactionId: "transaction-1",
      tx: { taskPaymentClaim: { create } },
    });

    expect(claimId).toBe("claim-1");
    expect(create).toHaveBeenCalledWith({
      data: {
        blockchainIdentifier: "chain-1",
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
});
