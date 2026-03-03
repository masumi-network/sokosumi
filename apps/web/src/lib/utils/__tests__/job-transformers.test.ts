import {
  transactionStatusToOnChainTransactionStatus,
  transformPurchaseToJobUpdate,
} from "@/lib/utils/job-transformers";

type PurchaseInput = Parameters<typeof transformPurchaseToJobUpdate>[0];

function buildPurchase(
  overrides?: Partial<PurchaseInput>,
): PurchaseInput {
  return {
    id: "purchase_1",
    onChainState: "FundsLocked",
    inputHash: "input_hash_1",
    resultHash: null,
    NextAction: {
      requestedAction: "None",
      errorType: null,
      errorNote: null,
    },
    CurrentTransaction: {
      txHash: "tx_hash_1",
      status: "FailedViaManualReset",
    },
    ...overrides,
  };
}

describe("transactionStatusToOnChainTransactionStatus", () => {
  it("maps FailedViaManualReset transaction status to FAILED", () => {
    const status =
      transactionStatusToOnChainTransactionStatus("FailedViaManualReset");

    expect(status).toBe("FAILED");
  });
});

describe("transformPurchaseToJobUpdate", () => {
  it("maps FailedViaManualReset transaction status to FAILED", () => {
    const purchase = buildPurchase();

    const transformedPurchase = transformPurchaseToJobUpdate(purchase);

    expect(transformedPurchase.onChainTransactionStatus).toBe("FAILED");
  });
});
