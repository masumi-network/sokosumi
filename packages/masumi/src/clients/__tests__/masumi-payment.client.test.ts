import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "../masumi-payment.client.js";

const getPurchaseMock = vi.fn();
const postPurchaseMock = vi.fn();
const postPurchaseResolveBlockchainIdentifierMock = vi.fn();

vi.mock("../openapi/generated/payment/index.js", () => ({
  getPurchase: (...args: unknown[]) => getPurchaseMock(...args),
  postPurchase: (...args: unknown[]) => postPurchaseMock(...args),
  postPurchaseResolveBlockchainIdentifier: (...args: unknown[]) =>
    postPurchaseResolveBlockchainIdentifierMock(...args),
}));

describe("createPaymentClient polling requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPurchaseMock.mockResolvedValue({
      data: {
        data: {
          Purchases: [{ id: "purchase_1" }],
        },
      },
      error: undefined,
      response: {
        status: 200,
      },
    });
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
    postPurchaseMock.mockResolvedValue({
      data: {
        data: { id: "task_purchase_1" },
      },
      error: undefined,
      response: { status: 200 },
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
    const byIdResult = await client.getPurchaseById("purchase_1", {
      signal: abortSignal,
    });

    expect(byBlockchainIdentifierResult.isOk()).toBe(true);
    expect(byIdResult.isOk()).toBe(true);
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: abortSignal,
        body: expect.objectContaining({
          blockchainIdentifier: "job-chain-1",
          network: "Preprod",
        }),
      }),
    );
    expect(getPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: abortSignal,
        query: expect.objectContaining({
          cursorId: "purchase_1",
          network: "Preprod",
          limit: 1,
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
    const byIdResult = await client.getPurchaseById("purchase_2");

    expect(byBlockchainIdentifierResult.isOk()).toBe(true);
    expect(byIdResult.isOk()).toBe(true);
    expect(postPurchaseResolveBlockchainIdentifierMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: undefined,
        body: expect.objectContaining({
          blockchainIdentifier: "job-chain-2",
          network: "Mainnet",
        }),
      }),
    );
    expect(getPurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: undefined,
        query: expect.objectContaining({
          cursorId: "purchase_2",
          network: "Mainnet",
          limit: 1,
        }),
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
        }),
      }),
    );
  });
});
