import { describe, expect, it } from "vitest";

import { transformPurchaseToJobUpdate } from "./purchase";

type PurchaseInput = Parameters<typeof transformPurchaseToJobUpdate>[0];

function buildPurchase(overrides?: Partial<PurchaseInput>): PurchaseInput {
  return {
    id: "purchase_1",
    onChainState: "FundsLocked",
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
  } as PurchaseInput;
}

describe("transformPurchaseToJobUpdate", () => {
  it("maps FailedViaManualReset transaction status to FAILED", () => {
    const purchase = buildPurchase();

    const transformedPurchase = transformPurchaseToJobUpdate(purchase);

    expect(transformedPurchase.onChainTransactionStatus).toBe("FAILED");
  });
});
