import { createPaymentClient } from "../masumi-payment.client.js";

const getPurchaseMock = jest.fn();
const postPurchaseResolveBlockchainIdentifierMock = jest.fn();

jest.mock("../openapi/generated/payment/index.js", () => ({
  getPurchase: (...args: unknown[]) => getPurchaseMock(...args),
  postPurchaseResolveBlockchainIdentifier: (...args: unknown[]) =>
    postPurchaseResolveBlockchainIdentifierMock(...args),
}));

describe("createPaymentClient polling requests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
