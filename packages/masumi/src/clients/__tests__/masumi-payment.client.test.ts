import type { StartPaidJobResponseSchemaType } from "@sokosumi/masumi/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "../masumi-payment.client.js";

const getRailReadinessMock = vi.fn();
const postPurchaseMock = vi.fn();
const postPurchaseRequestRefundMock = vi.fn();
const postPurchaseResolveBlockchainIdentifierMock = vi.fn();

vi.mock("../openapi/generated/payment/index.js", () => ({
  getRailReadiness: (...args: unknown[]) => getRailReadinessMock(...args),
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
        data: { id: "purchase_existing" },
      },
      error: undefined,
      response: { status: 200 },
    });
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
    expect(result.isErr() && result.error).toBe(
      "Failed to resolve duplicate purchase",
    );
  });

  it("rejects an embedded purchase whose identifier does not match", async () => {
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
  });

  it("rejects a malformed embedded purchase object", async () => {
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
        data: { id: "purchase_existing" },
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
    // The status suffix lets callers distinguish non-transient 4xx rejections
    // (price drift) from transient node failures.
    expect(result.isErr() && result.error).toBe(
      "Failed to create purchase request (status 400)",
    );
    expect(postPurchaseResolveBlockchainIdentifierMock).not.toHaveBeenCalled();
  });
});

describe("getCardanoV2RailReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok(true) when the CardanoV2 rail reports ready", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [
            { rail: "CardanoV2", isReady: true },
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
    expect(result.isOk() && result.value).toBe(true);
  });

  it("returns ok(false) when the CardanoV2 rail reports not ready", async () => {
    getRailReadinessMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Rails: [{ rail: "CardanoV2", isReady: false }],
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
    expect(result.isOk() && result.value).toBe(false);
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
        data: { id: "task_purchase_existing" },
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
});
