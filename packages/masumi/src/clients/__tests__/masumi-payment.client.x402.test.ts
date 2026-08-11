import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "../masumi-payment.client.js";

const getX402NetworksAvailableMock = vi.fn();
const getX402BudgetsMock = vi.fn();
const getApiKeyStatusMock = vi.fn();

vi.mock("../openapi/generated/payment/index.js", () => ({
  getX402NetworksAvailable: (...args: unknown[]) =>
    getX402NetworksAvailableMock(...args),
  getX402Budgets: (...args: unknown[]) => getX402BudgetsMock(...args),
  getApiKeyStatus: (...args: unknown[]) => getApiKeyStatusMock(...args),
}));

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function availableNetwork(overrides: Record<string, unknown> = {}) {
  return {
    id: "x402net_1",
    caip2Id: "eip155:84532",
    displayName: "Base Sepolia",
    isTestnet: true,
    isEnabled: true,
    canSettle: false,
    defaultAsset: USDC_BASE_SEPOLIA,
    defaultAssetDecimals: 6,
    ...overrides,
  };
}

function budget(overrides: Record<string, unknown> = {}) {
  return {
    id: "x402budget_1",
    apiKeyId: "apikey_1",
    evmWalletId: "wallet_1",
    evmWalletAddress: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
    caip2Network: "eip155:84532",
    asset: USDC_BASE_SEPOLIA,
    remainingAmount: "1000000",
    spentAmount: "0",
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createClient(network: "Preprod" | "Mainnet" = "Preprod") {
  return createPaymentClient(network, "https://payment.example.com", "api-key");
}

describe("getX402AvailableNetworks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the node's network rows on success", async () => {
    const networks = [availableNetwork()];
    getX402NetworksAvailableMock.mockResolvedValue({
      data: { status: "success", data: { Networks: networks } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402AvailableNetworks();

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual(networks);
  });

  it("requests testnet chains for Preprod and mainnet chains for Mainnet", async () => {
    getX402NetworksAvailableMock.mockResolvedValue({
      data: { status: "success", data: { Networks: [] } },
      error: undefined,
      response: { status: 200 },
    });

    await createClient("Preprod").getX402AvailableNetworks();
    expect(getX402NetworksAvailableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { isTestnet: "true" } }),
    );

    await createClient("Mainnet").getX402AvailableNetworks();
    expect(getX402NetworksAvailableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { isTestnet: "false" } }),
    );
  });

  it("forwards the abort signal", async () => {
    getX402NetworksAvailableMock.mockResolvedValue({
      data: { status: "success", data: { Networks: [] } },
      error: undefined,
      response: { status: 200 },
    });
    const signal = new AbortController().signal;

    await createClient().getX402AvailableNetworks({ signal });

    expect(getX402NetworksAvailableMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });

  it("returns an error with the node status and message on failure", async () => {
    getX402NetworksAvailableMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "unauthorized" } },
      response: { status: 401 },
    });

    const result = await createClient().getX402AvailableNetworks();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toBe(
      "x402 networks/available 401: unauthorized",
    );
  });

  it("returns an error when the request throws", async () => {
    getX402NetworksAvailableMock.mockRejectedValue(new Error("network down"));

    const result = await createClient().getX402AvailableNetworks();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatch(/network down/);
  });
});

describe("getX402Budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiKeyStatusMock.mockResolvedValue({
      data: { status: "success", data: { id: "apikey_own" } },
      error: undefined,
      response: { status: 200 },
    });
  });

  it("returns the node's budget rows on success", async () => {
    const budgets = [budget()];
    getX402BudgetsMock.mockResolvedValue({
      data: { status: "success", data: { Budgets: budgets } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402Budgets();

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual(budgets);
  });

  it("filters the admin-scoped budget list to its own API key", async () => {
    // GET /x402/budgets is admin-only and returns EVERY key's rows unless
    // filtered — but POST /x402/pay only draws on budgets granted to the
    // calling key, so an unfiltered read would mark pairs ready off budgets
    // this key can never spend.
    getX402BudgetsMock.mockResolvedValue({
      data: { status: "success", data: { Budgets: [] } },
      error: undefined,
      response: { status: 200 },
    });

    await createClient().getX402Budgets();

    expect(getX402BudgetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { apiKeyId: "apikey_own" } }),
    );
  });

  it("fails when the own-key lookup fails instead of reading unscoped", async () => {
    getApiKeyStatusMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "unauthorized" } },
      response: { status: 401 },
    });

    const result = await createClient().getX402Budgets();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toBe(
      "api-key-status 401: unauthorized",
    );
    expect(getX402BudgetsMock).not.toHaveBeenCalled();
  });

  it("refuses the unscoped read when the key id is missing or empty", async () => {
    // A version-skewed node can answer 200 with no id. The hey-api query
    // serializer silently DROPS an undefined apiKeyId param, which would turn
    // the call into exactly the unscoped admin read the resolution prevents.
    for (const data of [{}, { id: "" }]) {
      getX402BudgetsMock.mockClear();
      getApiKeyStatusMock.mockResolvedValue({
        data: { status: "success", data },
        error: undefined,
        response: { status: 200 },
      });

      const result = await createClient().getX402Budgets();

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error).toContain(
        "refusing unscoped budgets read",
      );
      expect(getX402BudgetsMock).not.toHaveBeenCalled();
    }
  });

  it("forwards the abort signal", async () => {
    getX402BudgetsMock.mockResolvedValue({
      data: { status: "success", data: { Budgets: [] } },
      error: undefined,
      response: { status: 200 },
    });
    const signal = new AbortController().signal;

    await createClient().getX402Budgets({ signal });

    expect(getApiKeyStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(getX402BudgetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });

  it("returns an error with the node status and message on failure", async () => {
    getX402BudgetsMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "budget backend down" } },
      response: { status: 500 },
    });

    const result = await createClient().getX402Budgets();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toBe(
      "x402 budgets 500: budget backend down",
    );
  });

  it("returns an error when the request throws", async () => {
    getX402BudgetsMock.mockRejectedValue(new Error("socket hang up"));

    const result = await createClient().getX402Budgets();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatch(/socket hang up/);
  });
});
