import type { StartPaidJobResponseSchemaType } from "@sokosumi/masumi/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "./masumi-payment.client.js";

const getRailReadinessMock = vi.fn();
const getPurchaseDiffMock = vi.fn();
const postPurchaseMock = vi.fn();
const postPurchaseRequestRefundMock = vi.fn();
const postPurchaseResolveBlockchainIdentifierMock = vi.fn();

vi.mock("./openapi/generated/payment/index.js", () => ({
  getRailReadiness: (...args: unknown[]) => getRailReadinessMock(...args),
  getPurchaseDiff: (...args: unknown[]) => getPurchaseDiffMock(...args),
  postPurchase: (...args: unknown[]) => postPurchaseMock(...args),
  postPurchaseRequestRefund: (...args: unknown[]) =>
    postPurchaseRequestRefundMock(...args),
  postPurchaseResolveBlockchainIdentifier: (...args: unknown[]) =>
    postPurchaseResolveBlockchainIdentifierMock(...args),
}));

const startJobResponse: StartPaidJobResponseSchemaType = {
  id: "job_1",
  input_hash: "input-hash",
  identifierFromPurchaser: "aabbccddeeff00112233",
  blockchainIdentifier: "job-chain-1",
  payByTime: 1775737949000,
  submitResultTime: 1775681853000,
  unlockTime: 1775763149000,
  externalDisputeUnlockTime: 1775784749000,
  agentIdentifier: "agent1",
  sellerVKey: "vkey1",
};

function createResolvedPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase_existing",
    createdAt: new Date("2026-01-05T09:00:00.000Z"),
    blockchainIdentifier: startJobResponse.blockchainIdentifier,
    agentIdentifier: startJobResponse.agentIdentifier,
    inputHash: startJobResponse.input_hash,
    payByTime: startJobResponse.payByTime.toString(),
    submitResultTime: startJobResponse.submitResultTime.toString(),
    unlockTime: startJobResponse.unlockTime.toString(),
    externalDisputeUnlockTime:
      startJobResponse.externalDisputeUnlockTime.toString(),
    metadata: JSON.stringify({ inputData: {}, jobId: startJobResponse.id }),
    PaidFunds: [{ amount: "1000000", unit: "" }],
    PaymentSource: {
      paymentSourceType: "Web3CardanoV1",
      smartContractAddress: "addr_test1_contract",
    },
    SellerWallet: {
      id: "seller_wallet_1",
      walletVkey: startJobResponse.sellerVKey,
    },
    SmartContractWallet: null,
    nextActionOrOnChainStateOrResultLastChangedAt: new Date(
      "2026-01-05T10:00:00.000Z",
    ),
    ...overrides,
  };
}

describe("createPaymentClient polling requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: {
          id: "purchase_1",
        },
      },
      error: undefined,
      response: {
        status: 200,
      },
    });
  });

  it("forwards abort signals to purchase polling requests", async () => {
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );
    const abortSignal = AbortSignal.timeout(1000);

    const byBlockchainIdentifierResult =
      await client.getPurchaseByBlockchainIdentifier("job-chain-1", {
        signal: abortSignal,
      });

    expect(byBlockchainIdentifierResult.isOk()).toBe(true);
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: abortSignal,
        body: expect.objectContaining({
          blockchainIdentifier: "job-chain-1",
          network: "Preprod",
        }),
      }),
    );
  });

  it("remains backward compatible when no options are provided", async () => {
    const client = createPaymentClient(
      "Mainnet",
      "https://payment.example.com",
      "api-key",
    );

    const byBlockchainIdentifierResult =
      await client.getPurchaseByBlockchainIdentifier("job-chain-2");

    expect(byBlockchainIdentifierResult.isOk()).toBe(true);
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: undefined,
        body: expect.objectContaining({
          blockchainIdentifier: "job-chain-2",
          network: "Mainnet",
        }),
      }),
    );
  });
});

describe("createPurchase duplicate handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase(),
      },
      error: undefined,
      response: { status: 200 },
    });
  });

  it("accepts a duplicate whose hex identifiers differ only in case", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          blockchainIdentifier:
            startJobResponse.blockchainIdentifier.toUpperCase(),
          agentIdentifier: startJobResponse.agentIdentifier.toUpperCase(),
          inputHash: startJobResponse.input_hash.toUpperCase(),
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    // Hex casing carries no meaning; treating it as a mismatch would refund a
    // buyer whose purchase is live at the node.
    expect(result.isOk()).toBe(true);
  });

  it("forwards the V2 payment-source selection", async () => {
    postPurchaseMock.mockResolvedValue({
      data: {
        data: { id: "purchase_v2" },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      {
        ...startJobResponse,
        paymentSourceType: "Web3CardanoV2",
        supportedPaymentSourceIndex: 3,
      },
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isOk()).toBe(true);
    expect(postPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: 3,
        }),
      }),
    );
  });

  it("forwards the price-drift guard Amounts when provided", async () => {
    postPurchaseMock.mockResolvedValue({
      data: {
        data: { id: "purchase_guarded" },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const amounts = [{ amount: "1000000", unit: "" }];
    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
      amounts,
    );

    expect(result.isOk()).toBe(true);
    expect(postPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          Amounts: [{ amount: "1000000", unit: "" }],
        }),
      }),
    );
  });

  it("omits the Amounts key when no amounts are provided", async () => {
    postPurchaseMock.mockResolvedValue({
      data: {
        data: { id: "purchase_unguarded" },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isOk()).toBe(true);
    expect(postPurchaseMock.mock.calls[0]?.[0].body).not.toHaveProperty(
      "Amounts",
    );
  });

  it("confirms a 409 duplicate through the scope-filtered resolve endpoint", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        id: "purchase_existing",
        object: {
          id: "purchase_existing",
          blockchainIdentifier: "job-chain-1",
        },
      },
      response: { status: 409 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.id).toBe("purchase_existing");
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledTimes(
      1,
    );
  });

  it("rejects a guarded duplicate charged at another amount", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          PaidFunds: [{ amount: "2000000", unit: "" }],
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
      [{ amount: "1000000", unit: "lovelace" }],
    );

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      message: "Duplicate purchase does not match request",
    });
  });

  it("matches normalized and summed duplicate funds", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
      [
        { amount: "400000", unit: "lovelace" },
        { amount: "600000", unit: "" },
      ],
    );

    expect(result.isOk()).toBe(true);
  });

  it("rejects a same-key duplicate that does not match the request", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({ inputHash: "different-input-hash" }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      message: "Duplicate purchase does not match request",
    });
  });

  it("rejects a duplicate belonging to a different seller wallet", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          SellerWallet: {
            id: "seller_wallet_other",
            walletVkey: "different-seller-vkey",
          },
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      message: "Duplicate purchase does not match request",
    });
  });

  it("matches a V2 duplicate against its request seller wallet", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          PaymentSource: {
            paymentSourceType: "Web3CardanoV2",
            smartContractAddress: "addr_test1_contract",
          },
          SellerWallet: {
            id: "seller_wallet_1",
            walletVkey: startJobResponse.sellerVKey,
          },
          SmartContractWallet: {
            id: "smart_contract_wallet_1",
            walletVkey: "different-smart-contract-vkey",
            walletAddress: "addr_test1_seller",
          },
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      {
        ...startJobResponse,
        paymentSourceType: "Web3CardanoV2",
        supportedPaymentSourceIndex: 0,
      },
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.id).toBe("purchase_existing");
  });

  it("errors on a 409 whose purchase is not visible to this API key", async () => {
    // Wallet-scoped keys: the node's duplicate check is unscoped, so a
    // foreign purchase can trigger the 409 — resolve 404s under the scope
    // filter and the embedded object must NOT be adopted.
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        id: "purchase_foreign",
        object: {
          id: "purchase_foreign",
          blockchainIdentifier: "job-chain-1",
        },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: undefined,
      error: { status: "error", error: { message: "Purchase not found" } },
      response: { status: 404 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
  });

  it("rejects the unscoped embedded purchase when resolve fails transiently", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        id: "purchase_existing",
        object: {
          id: "purchase_existing",
          blockchainIdentifier: "job-chain-1",
        },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockRejectedValue(
      new Error("network down"),
    );
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "ambiguous",
      message: "Failed to resolve duplicate purchase",
    });
  });

  // The 409 body may embed a purchase object. The client deliberately never
  // trusts it — it always reconciles through the resolve endpoint — so these
  // two cases pin that the embedded object is ignored, whatever it contains.
  it("ignores a mismatched embedded purchase and still reconciles via resolve", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        id: "purchase_other",
        object: {
          id: "purchase_other",
          blockchainIdentifier: "some-other-chain",
        },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockRejectedValue(
      new Error("network down"),
    );
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    // The embedded object is never trusted as the purchase.
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalled();
  });

  it("ignores a malformed embedded purchase and still reconciles via resolve", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        object: { blockchainIdentifier: "job-chain-1" },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockRejectedValue(
      new Error("network down"),
    );
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    // The embedded object is never trusted as the purchase.
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalled();
  });

  it("falls back to resolving a 409 response without a purchase object", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase(),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.id).toBe("purchase_existing");
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledTimes(
      1,
    );
  });

  it("returns an error when a malformed 409 cannot be resolved", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: undefined,
      error: { status: "error", error: { message: "Purchase not found" } },
      response: { status: 404 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledTimes(
      1,
    );
  });

  it("keeps returning an error for non-409 failures", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { status: "error", error: { message: "Bad request" } },
      response: { status: 400 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchase(
      "agent1",
      startJobResponse,
      {},
      "aabbccddeeff00112233",
    );

    expect(result.isErr()).toBe(true);
    // Preserve both the status and the node's structured explanation.
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      status: 400,
      message: "Failed to create purchase request (status 400): Bad request",
    });
    expect(postPurchaseResolveBlockchainIdentifierMock).not.toHaveBeenCalled();
  });
});

describe("createPurchase failure classification", () => {
  // A `permanent` verdict is terminal on the task-payment rail: it refunds the
  // claim, drops it out of PENDING and the unique index blocks resubmission.
  // Credential/routing failures must therefore stay retryable.
  it.each([401, 403, 404])(
    "classifies %i as ambiguous, not a permanent rejection",
    async (status: number) => {
      postPurchaseMock.mockResolvedValue({
        data: undefined,
        error: { status: "error", error: { message: "nope" } },
        response: { status },
      });
      postPurchaseResolveBlockchainIdentifierMock.mockRejectedValue(
        new Error("unreachable"),
      );
      const client = createPaymentClient(
        "Preprod",
        "https://payment.example.com",
        "api-key",
      );

      const result = await client.createPurchase(
        "agent1",
        startJobResponse,
        {},
        "aabbccddeeff00112233",
      );

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.kind).toBe("ambiguous");
    },
  );
});

describe("getCardanoV2RailReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns purchase-ready sources even when inbound selling is not ready", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [
            {
              rail: "CardanoV2",
              isReady: false,
              PurchaseSources: [
                {
                  policyId: "ab".repeat(28),
                  smartContractAddress: "addr_test1_v2_contract",
                  isPurchaseReady: true,
                  Checks: [],
                },
              ],
            },
            { rail: "X402", isReady: false },
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual([
      {
        policyId: "ab".repeat(28),
        smartContractAddress: "addr_test1_v2_contract",
      },
    ]);
  });

  it("canonicalizes readiness policy ids and Cardano addresses", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [
            {
              rail: "CardanoV2",
              isReady: true,
              PurchaseSources: [
                {
                  policyId: "AB".repeat(28),
                  smartContractAddress: "ADDR_TEST1_MIXED_CASE_CONTRACT",
                  isPurchaseReady: true,
                  Checks: [],
                },
              ],
            },
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isOk() && result.value).toEqual([
      {
        policyId: "ab".repeat(28),
        smartContractAddress: "addr_test1_mixed_case_contract",
      },
    ]);
  });

  it("excludes sources that are not purchase-ready", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [
            {
              rail: "CardanoV2",
              isReady: false,
              PurchaseSources: [
                {
                  policyId: "ab".repeat(28),
                  smartContractAddress: "addr_test1_v2_contract",
                  isPurchaseReady: false,
                  Checks: [],
                },
              ],
            },
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual([]);
  });

  it("drops purchase-ready sources with malformed policy ids", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [
            {
              rail: "CardanoV2",
              isReady: true,
              PurchaseSources: [
                {
                  policyId: "too-short",
                  smartContractAddress: "addr_test1_v2_contract",
                  isPurchaseReady: true,
                  Checks: [],
                },
              ],
            },
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual([]);
  });

  it("fails closed when the node omits per-source readiness", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [{ rail: "CardanoV2", isReady: true }],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain(
      "does not include per-source purchase readiness",
    );
  });

  it("returns an error when the readiness endpoint reports an error", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: undefined,
      error: { status: "error", error: { message: "Unauthorized" } },
      response: { status: 401 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toBe(
      "rail-readiness 401: Unauthorized",
    );
  });

  it("returns an error when the readiness response has no data", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.getCardanoV2RailReadiness();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("rail-readiness 200");
  });

  it("forwards the client network as the readiness query", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [{ rail: "CardanoV2", isReady: true, PurchaseSources: [] }],
        },
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    await client.getCardanoV2RailReadiness();

    expect(getRailReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { network: "Preprod" },
      }),
    );
  });
});

describe("createPurchaseFromMasumiTaskPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postPurchaseMock.mockResolvedValue({
      data: {
        data: { id: "task_purchase_1" },
      },
      error: undefined,
      response: { status: 200 },
    });
  });

  it("posts purchase with Amounts and network", async () => {
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const amounts = [{ amount: "470000000000", unit: "16a55b2a349361ff" }];
    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: amounts,
      identifierFromPurchaser: "aabbccddeeff00112233",
      metadata: JSON.stringify({ taskId: "tsk_1", taskEventId: "evt_1" }),
      paymentSourceType: "Web3CardanoV2",
      smartContractAddress: "addr_test1_contract",
      supportedPaymentSourceIndex: 2,
    });

    expect(result.isOk()).toBe(true);
    expect(postPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          network: "Preprod",
          blockchainIdentifier: "chain1",
          agentIdentifier: "agent1",
          Amounts: amounts,
          identifierFromPurchaser: "aabbccddeeff00112233",
          metadata: JSON.stringify({ taskId: "tsk_1", taskEventId: "evt_1" }),
          paymentSourceType: "Web3CardanoV2",
          smartContractAddress: "addr_test1_contract",
          supportedPaymentSourceIndex: 2,
        }),
      }),
    );
  });

  it("spells ADA the node's way, leaving other assets untouched", async () => {
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    // A caller may spell ADA either way — the registry serves both, and the
    // credit charge normalizes both to `lovelace`. POST /purchase documents an
    // empty unit for ADA, so `lovelace` must not reach the node: it names no
    // asset there, and the purchase could never settle against a debit that
    // was already taken and correct.
    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [
        { amount: "470000000000", unit: "lovelace" },
        { amount: "1000000", unit: "" },
        { amount: "25", unit: "16a55b2a349361ff" },
      ],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isOk()).toBe(true);
    expect(postPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          Amounts: [
            { amount: "470000000000", unit: "" },
            { amount: "1000000", unit: "" },
            { amount: "25", unit: "16a55b2a349361ff" },
          ],
        }),
      }),
    );
  });

  it("confirms a 409 duplicate through the scope-filtered resolve endpoint", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: {
        status: "error",
        error: { message: "Purchase already exists" },
        id: "task_purchase_existing",
        object: {
          id: "task_purchase_existing",
          blockchainIdentifier: "chain1",
        },
      },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          id: "task_purchase_existing",
          blockchainIdentifier: "chain1",
          inputHash: "abc",
          metadata: null,
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.id).toBe("task_purchase_existing");
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledTimes(
      1,
    );
  });

  it("classifies node 400 as a permanent task purchase failure", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Invalid inputHash" } },
      response: { status: 400 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      status: 400,
    });
  });

  it("classifies node 500 as ambiguous", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Internal error" } },
      response: { status: 500 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "ambiguous",
      status: 500,
    });
  });

  it("classifies a mismatched duplicate as permanent", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          blockchainIdentifier: "chain1",
          agentIdentifier: "different-agent",
          inputHash: "abc",
          metadata: null,
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatchObject({
      kind: "permanent",
      status: 409,
    });
  });

  it("adopts a duplicate whose timestamps differ only in spelling", async () => {
    // We send a string, the node stores a number and echoes the canonical
    // form. Comparing raw would report `mismatch` — and `mismatch` refunds the
    // buyer while the on-chain purchase stays live, so the escrow would be
    // funded from Sokosumi's wallet and the credits handed back.
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          blockchainIdentifier: "chain1",
          agentIdentifier: "agent1",
          inputHash: "abc",
          metadata: null,
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      // Same instants as the resolved purchase, written with leading zeros.
      submitResultTime: "01775681853000",
      payByTime: "01775737949000",
      unlockTime: "01775763149000",
      externalDisputeUnlockTime: "01775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isOk()).toBe(true);
  });

  it("still refuses a duplicate whose timestamps are genuinely different", async () => {
    postPurchaseMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "Purchase already exists" } },
      response: { status: 409 },
    });
    postPurchaseResolveBlockchainIdentifierMock.mockResolvedValue({
      data: {
        data: createResolvedPurchase({
          blockchainIdentifier: "chain1",
          agentIdentifier: "agent1",
          inputHash: "abc",
          metadata: null,
        }),
      },
      error: undefined,
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );

    const result = await client.createPurchaseFromMasumiTaskPayment({
      blockchainIdentifier: "chain1",
      agentIdentifier: "agent1",
      sellerVkey: "vkey1",
      submitResultTime: "1775681853000",
      payByTime: "1999999999000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash: "abc",
      Amounts: [{ amount: "1000000", unit: "" }],
      identifierFromPurchaser: "aabbccddeeff00112233",
    });

    expect(result.isErr()).toBe(true);
  });

  it("forwards abort signals through task purchase creation", async () => {
    const client = createPaymentClient(
      "Preprod",
      "https://payment.example.com",
      "api-key",
    );
    const signal = AbortSignal.timeout(1000);

    await client.createPurchaseFromMasumiTaskPayment(
      {
        blockchainIdentifier: "chain1",
        agentIdentifier: "agent1",
        sellerVkey: "vkey1",
        submitResultTime: "1775681853000",
        payByTime: "1775737949000",
        unlockTime: "1775763149000",
        externalDisputeUnlockTime: "1775784749000",
        inputHash: "abc",
        Amounts: [{ amount: "1000000", unit: "" }],
        identifierFromPurchaser: "aabbccddeeff00112233",
      },
      { signal },
    );

    expect(postPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });
});

describe("createPaymentClient purchase diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the changed purchases for the configured network", async () => {
    getPurchaseDiffMock.mockResolvedValue({
      data: { data: { Purchases: [createResolvedPurchase()] } },
      response: { status: 200 },
    });

    const client = createPaymentClient(
      "Preprod",
      "https://payment.test",
      "api-key",
    );
    const abortController = new AbortController();
    const result = await client.getPurchasesDiff(
      new Date("2026-01-05T10:00:00.000Z"),
      "purchase_cursor",
      25,
      { signal: abortController.signal },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(getPurchaseDiffMock).toHaveBeenCalledTimes(1);
    expect(getPurchaseDiffMock.mock.calls[0][0]).toMatchObject({
      query: {
        network: "Preprod",
        lastUpdate: "2026-01-05T10:00:00.000Z",
        cursorId: "purchase_cursor",
        limit: 25,
      },
    });
    // Without this a hung node would hold the sync lock for the whole run:
    // toMatchObject above would not notice the signal going missing.
    expect(getPurchaseDiffMock.mock.calls[0][0].signal).toBe(
      abortController.signal,
    );
  });

  it("omits the cursor on the first page", async () => {
    getPurchaseDiffMock.mockResolvedValue({
      data: { data: { Purchases: [] } },
      response: { status: 200 },
    });

    const client = createPaymentClient(
      "Mainnet",
      "https://payment.test",
      "api-key",
    );
    const result = await client.getPurchasesDiff(new Date(0), null, 25);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(getPurchaseDiffMock.mock.calls[0][0].query.cursorId).toBeUndefined();
  });

  it("returns an error when the node rejects the diff request", async () => {
    getPurchaseDiffMock.mockResolvedValue({
      error: { message: "unauthorized" },
      response: { status: 401 },
    });

    const client = createPaymentClient(
      "Preprod",
      "https://payment.test",
      "api-key",
    );
    const result = await client.getPurchasesDiff(new Date(0), null, 25);

    expect(result.isErr()).toBe(true);
  });

  it("rejects an invalid diff cursor timestamp", async () => {
    getPurchaseDiffMock.mockResolvedValue({
      data: {
        data: {
          Purchases: [
            createResolvedPurchase({
              nextActionOrOnChainStateOrResultLastChangedAt: new Date(
                Number.NaN,
              ),
            }),
          ],
        },
      },
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.test",
      "api-key",
    );

    const result = await client.getPurchasesDiff(new Date(0), null, 25);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("invalid change timestamp");
  });

  it("rejects a diff cursor timestamp coerced from null", async () => {
    getPurchaseDiffMock.mockResolvedValue({
      data: {
        data: {
          Purchases: [
            createResolvedPurchase({
              // The generated transformer converts a wire-level null to epoch.
              nextActionOrOnChainStateOrResultLastChangedAt: new Date(0),
            }),
          ],
        },
      },
      response: { status: 200 },
    });
    const client = createPaymentClient(
      "Preprod",
      "https://payment.test",
      "api-key",
    );

    const result = await client.getPurchasesDiff(new Date(0), null, 25);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("invalid change timestamp");
  });
});
