import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPurchaseByBlockchainIdentifier = vi.fn();

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({ getPurchaseByBlockchainIdentifier }),
}));

import { resolveTaskSellerReceipt } from "@/helpers/coworker-task-receipt";

function dbWith(claim: unknown) {
  return {
    taskPaymentClaim: { findFirst: vi.fn().mockResolvedValue(claim) },
  } as unknown as Parameters<typeof resolveTaskSellerReceipt>[1];
}

describe("resolveTaskSellerReceipt", () => {
  beforeEach(() => getPurchaseByBlockchainIdentifier.mockReset());

  it("returns an empty receipt when the task has no payment claim", async () => {
    const receipt = await resolveTaskSellerReceipt("tsk_1", dbWith(null));
    expect(receipt.settled).toBe(false);
    expect(receipt.blockchainIdentifier).toBeNull();
    expect(getPurchaseByBlockchainIdentifier).not.toHaveBeenCalled();
  });

  it("proves the seller receipt when onChainState is Withdrawn", async () => {
    getPurchaseByBlockchainIdentifier.mockResolvedValue(
      ok({
        onChainState: "Withdrawn",
        CurrentTransaction: { txHash: "tx_withdrawn" },
        WithdrawnForSeller: [{ unit: "lovelace", amount: "500000" }],
      }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith({ blockchainIdentifier: "bc_1", status: "PURCHASED" }),
    );
    expect(receipt.settled).toBe(true);
    expect(receipt.onChainState).toBe("Withdrawn");
    expect(receipt.txHash).toBe("tx_withdrawn");
    expect(receipt.withdrawnForSeller).toEqual([
      { unit: "lovelace", amount: "500000" },
    ]);
  });

  it("does not treat FundsLocked (buyer debit) as a seller receipt", async () => {
    getPurchaseByBlockchainIdentifier.mockResolvedValue(
      ok({ onChainState: "FundsLocked", CurrentTransaction: null }),
    );
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith({ blockchainIdentifier: "bc_1", status: "PURCHASED" }),
    );
    expect(receipt.settled).toBe(false);
    expect(receipt.onChainState).toBe("FundsLocked");
  });

  it("returns claim state without settlement when the purchase cannot be resolved", async () => {
    getPurchaseByBlockchainIdentifier.mockResolvedValue(err("node down"));
    const receipt = await resolveTaskSellerReceipt(
      "tsk_1",
      dbWith({ blockchainIdentifier: "bc_1", status: "PURCHASED" }),
    );
    expect(receipt.settled).toBe(false);
    expect(receipt.blockchainIdentifier).toBe("bc_1");
    expect(receipt.claimStatus).toBe("PURCHASED");
  });
});
