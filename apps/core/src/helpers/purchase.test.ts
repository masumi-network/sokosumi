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

  it("maps the V2 authorized on-chain states", () => {
    expect(
      transformPurchaseToJobUpdate(
        buildPurchase({ onChainState: "WithdrawAuthorized" }),
      ).onChainStatus,
    ).toBe("WITHDRAW_AUTHORIZED");
    expect(
      transformPurchaseToJobUpdate(
        buildPurchase({ onChainState: "RefundAuthorized" }),
      ).onChainStatus,
    ).toBe("REFUND_AUTHORIZED");
  });

  it("maps the V2 authorize-withdrawal next actions", () => {
    expect(
      transformPurchaseToJobUpdate(
        buildPurchase({
          NextAction: {
            requestedAction: "AuthorizeWithdrawalRequested",
            errorType: null,
            errorNote: null,
          },
        }),
      ).nextAction,
    ).toBe("AUTHORIZE_WITHDRAWAL_REQUESTED");
    expect(
      transformPurchaseToJobUpdate(
        buildPurchase({
          NextAction: {
            requestedAction: "AuthorizeWithdrawalInitiated",
            errorType: null,
            errorNote: null,
          },
        }),
      ).nextAction,
    ).toBe("AUTHORIZE_WITHDRAWAL_INITIATED");
  });

  it("omits unknown on-chain states instead of throwing", () => {
    const transformedPurchase = transformPurchaseToJobUpdate(
      buildPurchase({ onChainState: "SomeFutureState" as never }),
    );

    expect("onChainStatus" in transformedPurchase).toBe(false);
    expect(transformedPurchase.nextAction).toBe("NONE");
  });

  it("omits unknown next actions instead of throwing", () => {
    const transformedPurchase = transformPurchaseToJobUpdate(
      buildPurchase({
        NextAction: {
          requestedAction: "SomeFutureAction" as never,
          errorType: null,
          errorNote: null,
        },
      }),
    );

    expect("nextAction" in transformedPurchase).toBe(false);
    expect(transformedPurchase.onChainStatus).toBe("FUNDS_LOCKED");
  });

  it("omits unknown next action error types instead of throwing", () => {
    const transformedPurchase = transformPurchaseToJobUpdate(
      buildPurchase({
        NextAction: {
          requestedAction: "None",
          errorType: "SomeFutureErrorType" as never,
          errorNote: null,
        },
      }),
    );

    expect("nextActionErrorType" in transformedPurchase).toBe(false);
    expect(transformedPurchase.nextAction).toBe("NONE");
  });

  it("omits transaction fields when the transaction status is unknown", () => {
    const purchase = buildPurchase();
    const transformedPurchase = transformPurchaseToJobUpdate({
      ...purchase,
      CurrentTransaction: purchase.CurrentTransaction
        ? {
            ...purchase.CurrentTransaction,
            status: "SomeFutureStatus" as never,
          }
        : null,
    });

    expect("onChainTransactionStatus" in transformedPurchase).toBe(false);
    expect("onChainTransactionHash" in transformedPurchase).toBe(false);
  });
});
