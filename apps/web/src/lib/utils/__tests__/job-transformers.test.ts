import type { PostPurchaseResponses } from "@sokosumi/masumi/clients";
import { describe, expect, it } from "vitest";

import {
  transactionStatusToOnChainTransactionStatus,
  transformPurchaseToJobUpdate,
} from "@/lib/utils/job-transformers";

type TransformPurchaseInput = Parameters<
  typeof transformPurchaseToJobUpdate
>[0];
type PaymentPurchase = PostPurchaseResponses["200"]["data"];
type PurchaseInput = Pick<
  PaymentPurchase,
  | "id"
  | "onChainState"
  | "inputHash"
  | "resultHash"
  | "NextAction"
  | "CurrentTransaction"
>;

function buildPurchase(overrides?: Partial<PurchaseInput>): PurchaseInput {
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
      id: "tx_1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      fees: null,
      blockHeight: null,
      blockTime: null,
      txHash: "tx_hash_1",
      status: "FailedViaManualReset",
      previousOnChainState: null,
      newOnChainState: null,
      confirmations: null,
    },
    ...overrides,
  };
}

describe("transactionStatusToOnChainTransactionStatus", () => {
  it("maps FailedViaManualReset transaction status to FAILED", () => {
    const status = transactionStatusToOnChainTransactionStatus(
      "FailedViaManualReset",
    );

    expect(status).toBe("FAILED");
  });
});

describe("transformPurchaseToJobUpdate", () => {
  it("maps FailedViaManualReset transaction status to FAILED", () => {
    const purchase: TransformPurchaseInput = buildPurchase();

    const transformedPurchase = transformPurchaseToJobUpdate(purchase);

    expect(transformedPurchase.onChainTransactionStatus).toBe("FAILED");
  });
});
