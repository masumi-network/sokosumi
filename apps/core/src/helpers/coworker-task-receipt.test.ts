import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMasumiTaskPaymentPurchase = vi.fn();

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({ resolveMasumiTaskPaymentPurchase }),
}));

import { resolveTaskSellerReceipt } from "@/helpers/coworker-task-receipt";

const purchasePayload = {
  blockchainIdentifier: "bc_1",
  agentIdentifier: "agent_1",
  sellerVkey: "vkey_1",
  submitResultTime: "1",
  payByTime: "1",
  unlockTime: "1",
  externalDisputeUnlockTime: "1",
  inputHash: "hash_1",
  Amounts: [{ amount: "500000", unit: "lovelace" }],
  identifierFromPurchaser: "purchaser_1",
};

function dbWith(claim: unknown) {
  return {
    taskPaymentClaim: { findFirst: vi.fn().mockResolvedValue(claim) },
  } as unknown as Parameters<typeof resolveTaskSellerReceipt>[1];
}

function claim(status: string) {
  return { blockchainIdentifier: "bc_1", purchasePayload, status };
}

describe("resolveTaskSellerReceipt", () => {
  beforeEach(() => resolveMasumiTaskPaymentPurchase.mockReset());

  it("returns an empty receipt when the task has no payment claim", async () => {
    const receipt = await resolveTaskSellerReceipt("tsk_1", dbWith(null));
    expect(receipt.settled).toBe(false);
    expect(receipt.blockchainIdentifier).toBeNull();
    expect(resolveMasumiTaskPaymentPurchase).not.toHaveBeenCalled();
  });

  it("resolves the purchase against the claim's stored terms", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({ onChainState: "FundsLocked", CurrentTransaction: null }),
    );
    await resolveTaskSellerReceipt("tsk_1", dbWith(claim("PURCHASED")));
    expect(resolveMasumiTaskPaymentPurchase).toHaveBeenCalledWith(
      purchasePayload,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("proves the seller receipt when onChainState is Withdrawn", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({
        onChainState: "Withdrawn",
        CurrentTransaction: { txHash: "tx_withdrawn" },
        WithdrawnForSeller: [{ unit: "lovelace", amount: "500000" }],
      }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("PURCHASED")),
    );
    expect(receipt.settled).toBe(true);
    expect(receipt.onChainState).toBe("Withdrawn");
    expect(receipt.txHash).toBe("tx_withdrawn");
    expect(receipt.withdrawnForSeller).toEqual([
      { unit: "lovelace", amount: "500000" },
    ]);
  });

  it("does not treat FundsLocked (buyer debit) as a seller receipt", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({ onChainState: "FundsLocked", CurrentTransaction: null }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("PURCHASED")),
    );
    expect(receipt.settled).toBe(false);
    expect(receipt.onChainState).toBe("FundsLocked");
  });

  it("treats DisputedWithdrawn with a seller payout as settled", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({
        onChainState: "DisputedWithdrawn",
        CurrentTransaction: { txHash: "tx_dispute" },
        WithdrawnForSeller: [{ unit: "lovelace", amount: "250000" }],
      }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("PURCHASED")),
    );
    expect(receipt.settled).toBe(true);
    expect(receipt.onChainState).toBe("DisputedWithdrawn");
  });

  it("does not treat DisputedWithdrawn without a seller payout as settled", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({ onChainState: "DisputedWithdrawn", WithdrawnForSeller: [] }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("PURCHASED")),
    );
    expect(receipt.settled).toBe(false);
  });

  it("does not treat a refund (RefundWithdrawn) as a seller receipt", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({
        onChainState: "RefundWithdrawn",
        CurrentTransaction: { txHash: "tx_refund" },
        WithdrawnForSeller: [],
      }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("REFUNDED")),
    );
    expect(receipt.settled).toBe(false);
  });

  it("returns claim state without settlement when the node has no purchase", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      err({ kind: "not_found", message: "Task purchase not found" }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("PENDING")),
    );
    expect(receipt.settled).toBe(false);
    expect(receipt.blockchainIdentifier).toBe("bc_1");
    expect(receipt.claimStatus).toBe("PENDING");
  });

  it("throws 502 instead of reporting unsettled when the node fails", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      err({ kind: "ambiguous", message: "node down" }),
    );
    await expect(
      resolveTaskSellerReceipt("tsk_1", dbWith(claim("PURCHASED"))),
    ).rejects.toMatchObject({
      status: 502,
      message:
        "Could not resolve the task payment from the Masumi Payment Service",
    });
  });

  it("throws 502 when the resolved purchase does not match the claim", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      err({ kind: "mismatch", message: "mismatch" }),
    );
    await expect(
      resolveTaskSellerReceipt("tsk_1", dbWith(claim("PURCHASED"))),
    ).rejects.toMatchObject({
      status: 502,
      message: "Resolved purchase does not match the task payment",
    });
  });

  it("reports a claim refunded for a mismatch as not settled", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      err({ kind: "mismatch", message: "mismatch" }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith(claim("REFUNDED")),
    );
    expect(receipt.settled).toBe(false);
    expect(receipt.claimStatus).toBe("REFUNDED");
  });

  it("throws a plain 500 when the stored payload cannot be read", async () => {
    await expect(
      resolveTaskSellerReceipt(
        "tsk_1",
        dbWith({ ...claim("PURCHASED"), purchasePayload: { bad: true } }),
      ),
    ).rejects.toMatchObject({
      status: 500,
      message: "Stored task payment cannot be read",
    });
    expect(resolveMasumiTaskPaymentPurchase).not.toHaveBeenCalled();
  });

  it("passes the caller's abort signal to the payment node", async () => {
    resolveMasumiTaskPaymentPurchase.mockResolvedValue(
      ok({ onChainState: "FundsLocked", CurrentTransaction: null }),
    );
    const controller = new AbortController();
    await resolveTaskSellerReceipt("tsk_1", dbWith(claim("PURCHASED")), {
      signal: controller.signal,
    });
    const { signal } = resolveMasumiTaskPaymentPurchase.mock.calls[0][1] as {
      signal: AbortSignal;
    };
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
