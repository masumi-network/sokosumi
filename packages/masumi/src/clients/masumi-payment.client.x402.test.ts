import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "./masumi-payment.client.js";

const getX402NetworksAvailableMock = vi.fn();
const getX402WalletsMock = vi.fn();
const getX402WalletsBalanceMock = vi.fn();
const getApiKeyStatusMock = vi.fn();
const postX402PayMock = vi.fn();

vi.mock("./openapi/generated/payment/index.js", () => ({
  getX402NetworksAvailable: (...args: unknown[]) =>
    getX402NetworksAvailableMock(...args),
  getX402Wallets: (...args: unknown[]) => getX402WalletsMock(...args),
  getX402WalletsBalance: (...args: unknown[]) =>
    getX402WalletsBalanceMock(...args),
  getApiKeyStatus: (...args: unknown[]) => getApiKeyStatusMock(...args),
  postX402Pay: (...args: unknown[]) => postX402PayMock(...args),
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

function keyStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: "apikey_own",
    canAdmin: true,
    canPay: true,
    usageLimited: false,
    RemainingUsageCredits: [] as { unit: string; amount: string }[],
    ...overrides,
  };
}

function statusResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: { status: "success", data: keyStatus(overrides) },
    error: undefined,
    response: { status: 200 },
  };
}

function purchasingWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: "wallet_1",
    networkId: "x402net_1",
    caip2Network: "eip155:84532",
    address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
    type: "Purchasing",
    note: null,
    createdById: "apikey_own",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function walletBalance(overrides: Record<string, unknown> = {}) {
  return {
    caip2Network: "eip155:84532",
    displayName: "Base Sepolia",
    native: { symbol: "ETH", decimals: 18, amount: "1" },
    asset: {
      asset: USDC_BASE_SEPOLIA,
      symbol: "USDC",
      decimals: 6,
      amount: "1000000",
    },
    error: null,
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

  it("errors on a 200 whose body has no Networks array", async () => {
    // Version-skewed node: 200 with `data` present but Networks missing must
    // not return ok(undefined) and crash the caller's iteration.
    getX402NetworksAvailableMock.mockResolvedValue({
      data: { status: "success", data: {} },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402AvailableNetworks();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("no Networks array");
  });

  it("fails closed when any network row is malformed", async () => {
    getX402NetworksAvailableMock.mockResolvedValue({
      data: {
        status: "success",
        data: { Networks: [availableNetwork(), availableNetwork({ id: 42 })] },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402AvailableNetworks();

    expect(result.isErr() && result.error).toContain("malformed row");
  });
});

describe("getX402KeySpendCaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums credits per eip155 unit and lowercases the unit", async () => {
    // Nothing on the node enforces one row per (key, unit), and its own debit
    // path judges the SUM, so a split ledger must not read as the first row.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [
          { unit: `eip155:84532:${USDC_BASE_SEPOLIA}`, amount: "400000" },
          {
            unit: `eip155:84532:${USDC_BASE_SEPOLIA.toLowerCase()}`,
            amount: "600000",
          },
        ],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isOk()).toBe(true);
    const caps = result.isOk() ? result.value : null;
    expect(caps?.usageLimited).toBe(true);
    expect(
      caps?.creditsByUnit.get(
        `eip155:84532:${USDC_BASE_SEPOLIA.toLowerCase()}`,
      ),
    ).toBe(1000000n);
  });

  it("drops the Cardano rail's rows from the same shared ledger", async () => {
    // lovelace and native-asset units live on the SAME UnitValue ledger. A
    // Cardano-funded key must never make an EVM pair look payable.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [
          { unit: "lovelace", amount: "5000000" },
          { unit: `eip155:84532:${USDC_BASE_SEPOLIA}`, amount: "1" },
        ],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    const caps = result.isOk() ? result.value : null;
    expect(caps?.creditsByUnit.size).toBe(1);
    expect(caps?.creditsByUnit.has("lovelace")).toBe(false);
  });

  it("reports no EVM credit for a key funded only on the Cardano rail", async () => {
    // The node refuses every x402 payment such a key makes. It once
    // grandfathered it to uncapped spend instead, which is why this case has
    // its own test.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [{ unit: "lovelace", amount: "5000000" }],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    const caps = result.isOk() ? result.value : null;
    expect(caps?.usageLimited).toBe(true);
    expect(caps?.creditsByUnit.size).toBe(0);
  });

  it("drops an eip155 row it cannot parse", async () => {
    // An unparsable amount adds nothing to its unit's sum, so the unit reads
    // zero and the pair delists. Treating it as credit would list a pair the
    // node refuses.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [
          { unit: `eip155:84532:${USDC_BASE_SEPOLIA}`, amount: "not-a-number" },
        ],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    const caps = result.isOk() ? result.value : null;
    expect(caps?.creditsByUnit.size).toBe(0);
  });

  it("drops an eip155 row whose amount is longer than any real balance", async () => {
    // 200 digits cannot be a uint256 balance, and BigInt() is superlinear in
    // digit count. Dropping the row costs the sync worker nothing, so the unit
    // reads zero and the pair delists.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [
          {
            unit: `eip155:84532:${USDC_BASE_SEPOLIA}`,
            amount: "9".repeat(200),
          },
        ],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    const caps = result.isOk() ? result.value : null;
    expect(caps?.creditsByUnit.size).toBe(0);
  });

  it("fails closed when the node returns more credit rows than a key can hold", async () => {
    // A real key holds one row per unit it has credit in, so thousands is
    // version skew or a node fault. Every row costs a BigInt parse.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: Array.from({ length: 1001 }, (_, index) => ({
          unit: `eip155:84532:${USDC_BASE_SEPOLIA}${index}`,
          amount: "1",
        })),
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("RemainingUsageCredits");
  });

  it("reports an unlimited key as uncapped", async () => {
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({ usageLimited: false }),
    );

    const result = await createClient().getX402KeySpendCaps();

    const caps = result.isOk() ? result.value : null;
    expect(caps?.usageLimited).toBe(false);
    expect(caps?.creditsByUnit.size).toBe(0);
  });

  it("fails closed when the node answers 200 without the credit rows", async () => {
    // RemainingUsageCredits is required, so an absent array is version skew,
    // never "this key holds no credits". Reading it as empty would delist
    // every x402 pair and report a funding problem the operator does not have.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: undefined,
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("RemainingUsageCredits");
  });

  it("fails closed when a credit row has the wrong shape", async () => {
    // Distinct from an unparsable AMOUNT, which is a string the node can
    // really hold and is judged per unit. A row whose amount is not even a
    // string is a contract break, and guessing at it could hide a real cap.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({
        usageLimited: true,
        RemainingUsageCredits: [
          { unit: `eip155:84532:${USDC_BASE_SEPOLIA}`, amount: 1000 },
        ],
      }),
    );

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("RemainingUsageCredits");
  });

  it("fails closed when the node answers 200 without the usageLimited flag", async () => {
    // Version skew must not read as "uncapped" and mark pairs ready that a
    // capped key cannot actually pay.
    getApiKeyStatusMock.mockResolvedValue({
      data: { status: "success", data: { id: "apikey_own" } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("usageLimited");
  });

  it("propagates a failed key-status resolution", async () => {
    getApiKeyStatusMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "unauthorized" } },
      response: { status: 401 },
    });

    const result = await createClient().getX402KeySpendCaps();

    expect(result.isErr()).toBe(true);
  });
});

describe("getX402PurchasingWallets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the purchasing wallets the node scopes to this key", async () => {
    const wallets = [purchasingWallet()];
    getApiKeyStatusMock.mockResolvedValue(statusResponse());
    getX402WalletsMock.mockResolvedValue({
      data: { status: "success", data: { Wallets: wallets } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isOk() && result.value).toEqual(wallets);
    expect(getX402WalletsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { take: 100, type: "Purchasing" } }),
    );
  });

  it("lists wallets for a scoped non-admin key", async () => {
    // masumi ADR 0016 removed per-wallet budgets, so a scoped non-admin key
    // is a first-class signer: the node returns the wallets it created plus
    // any an admin assigned to it. Gating on canAdmin here would delist every
    // chain for exactly the keys Soko is meant to run as.
    const wallets = [purchasingWallet()];
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({ canAdmin: false, canPay: true }),
    );
    getX402WalletsMock.mockResolvedValue({
      data: { status: "success", data: { Wallets: wallets } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isOk() && result.value).toEqual(wallets);
    expect(getX402WalletsMock).toHaveBeenCalledTimes(1);
  });

  it("lists nothing for a read-only key, which could never sign", async () => {
    // The node reads and pays at DIFFERENT permission tiers: GET /x402/wallets
    // is read-authenticated, POST /x402/pay is pay-authenticated. Listing a
    // read-only key's wallets would compose ready pairs whose every charge
    // 401s, and the pay path reads a 401 as ambiguous, so the record is held
    // instead of refunded. Never ask the node for that listing at all.
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({ canAdmin: false, canPay: false }),
    );

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isOk() && result.value).toEqual([]);
    expect(getX402WalletsMock).not.toHaveBeenCalled();
  });

  it("lists wallets for an admin key that carries no explicit pay flag", async () => {
    // The node's own hasPermission returns true for any admin key before it
    // looks at the required flags, so admin IS pay. Gating on canPay alone
    // would delist every chain for an admin key.
    const wallets = [purchasingWallet()];
    getApiKeyStatusMock.mockResolvedValue(
      statusResponse({ canAdmin: true, canPay: false }),
    );
    getX402WalletsMock.mockResolvedValue({
      data: { status: "success", data: { Wallets: wallets } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isOk() && result.value).toEqual(wallets);
  });

  it("lists nothing when the node reports neither permission flag", async () => {
    // Version skew: absent flags must not read as permitted.
    getApiKeyStatusMock.mockResolvedValue({
      data: { status: "success", data: { id: "apikey_own" } },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isOk() && result.value).toEqual([]);
    expect(getX402WalletsMock).not.toHaveBeenCalled();
  });

  it("fails closed when the wallet response is malformed", async () => {
    getApiKeyStatusMock.mockResolvedValue({
      data: { status: "success", data: { id: "apikey_own", canAdmin: true } },
      error: undefined,
      response: { status: 200 },
    });
    getX402WalletsMock.mockResolvedValue({
      data: { status: "success", data: {} },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toContain("no Wallets array");
  });

  it("fails closed when any wallet row is malformed", async () => {
    getApiKeyStatusMock.mockResolvedValue({
      data: { status: "success", data: { id: "apikey_own", canAdmin: true } },
      error: undefined,
      response: { status: 200 },
    });
    getX402WalletsMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          Wallets: [
            purchasingWallet(),
            purchasingWallet({ id: "malformed", address: "not-an-address" }),
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402PurchasingWallets();

    expect(result.isErr() && result.error).toContain("malformed row");
  });
});

describe("api-key-status memoization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the key once per client instance, concurrently or not", async () => {
    // Deliberately NOT paired with the wallet listing: that method no longer
    // resolves the key at all, so using it as the second caller would satisfy
    // this count without exercising the memo.
    getApiKeyStatusMock.mockResolvedValue(statusResponse());

    const client = createClient();
    // Concurrent first: the in-flight promise is shared, so a racing pair
    // costs one status request, not two.
    await Promise.all([
      client.getX402KeySpendCaps(),
      client.getX402KeySpendCaps(),
    ]);
    // And once settled, the resolved value is reused rather than refetched.
    await client.getX402KeySpendCaps();

    expect(getApiKeyStatusMock).toHaveBeenCalledTimes(1);
  });

  it("does not share the resolution across client instances", async () => {
    getApiKeyStatusMock.mockResolvedValue(statusResponse({ canAdmin: false }));

    // Spend caps, not the wallet listing: dropping the canAdmin gate left the
    // listing with no reason to resolve the key at all, so it no longer
    // exercises the memo (and now costs one request instead of two).
    await createClient().getX402KeySpendCaps();
    await createClient().getX402KeySpendCaps();

    expect(getApiKeyStatusMock).toHaveBeenCalledTimes(2);
  });

  it("never memoizes a failed resolution (a transient error must not poison the instance)", async () => {
    getApiKeyStatusMock.mockResolvedValueOnce({
      data: undefined,
      error: { error: { message: "unauthorized" } },
      response: { status: 401 },
    });
    getApiKeyStatusMock.mockResolvedValue(statusResponse());

    const client = createClient();
    const first = await client.getX402KeySpendCaps();
    expect(first.isErr()).toBe(true);

    const second = await client.getX402KeySpendCaps();
    expect(second.isOk()).toBe(true);
    expect(getApiKeyStatusMock).toHaveBeenCalledTimes(2);
  });

  it("one caller's abort neither fails a concurrent caller nor poisons the memo", async () => {
    // The shared fetch runs signal-less; each caller races its OWN signal.
    // Aborting caller A must return an error to A only — caller B still
    // gets the result, from the single shared request.
    const controller = new AbortController();
    let resolveStatus: (value: unknown) => void = () => undefined;
    getApiKeyStatusMock.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    const client = createClient();
    const abortedCall = client.getX402KeySpendCaps({
      signal: controller.signal,
    });
    // Both callers must be ones that actually await the shared resolution:
    // the wallet listing no longer does, so it would pass this vacuously.
    const unaffectedCall = client.getX402KeySpendCaps();
    controller.abort();

    const abortedResult = await abortedCall;
    expect(abortedResult.isErr()).toBe(true);

    resolveStatus(statusResponse({ usageLimited: false }));
    const unaffectedResult = await unaffectedCall;
    expect(unaffectedResult.isOk()).toBe(true);
    expect(unaffectedResult.isOk() && unaffectedResult.value.usageLimited).toBe(
      false,
    );
    expect(getApiKeyStatusMock).toHaveBeenCalledTimes(1);
  });

  it("never memoizes a thrown resolution either", async () => {
    getApiKeyStatusMock.mockRejectedValueOnce(new Error("socket hang up"));
    getApiKeyStatusMock.mockResolvedValue(statusResponse());

    const client = createClient();
    const first = await client.getX402KeySpendCaps();
    expect(first.isErr()).toBe(true);

    const second = await client.getX402KeySpendCaps();
    expect(second.isOk()).toBe(true);
    expect(getApiKeyStatusMock).toHaveBeenCalledTimes(2);
  });
});

describe("getX402WalletBalances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns managed wallet balances for the requested chain", async () => {
    const balances = [walletBalance()];
    getX402WalletsBalanceMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          evmWalletId: "wallet_1",
          address: purchasingWallet().address,
          Balances: balances,
        },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402WalletBalances({
      evmWalletId: "wallet_1",
      evmWalletAddress: purchasingWallet().address,
      caip2Network: "eip155:84532",
    });

    expect(result.isOk() && result.value).toEqual(balances);
    expect(getX402WalletsBalanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { id: "wallet_1", caip2Network: "eip155:84532" },
      }),
    );
  });

  it("fails closed when the node returns another wallet identity or no balance array", async () => {
    for (const data of [
      { evmWalletId: "wallet_other", Balances: [] },
      {
        evmWalletId: "wallet_1",
        address: "0x1111111111111111111111111111111111111111",
        Balances: [],
      },
      { evmWalletId: "wallet_1" },
    ]) {
      getX402WalletsBalanceMock.mockResolvedValue({
        data: { status: "success", data },
        error: undefined,
        response: { status: 200 },
      });

      const result = await createClient().getX402WalletBalances({
        evmWalletId: "wallet_1",
        evmWalletAddress: purchasingWallet().address,
        caip2Network: "eip155:84532",
      });

      expect(result.isErr()).toBe(true);
    }
  });

  it("fails closed when any balance row is malformed", async () => {
    getX402WalletsBalanceMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          evmWalletId: "wallet_1",
          address: purchasingWallet().address,
          Balances: [
            walletBalance(),
            walletBalance({ native: { amount: -1 } }),
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402WalletBalances({
      evmWalletId: "wallet_1",
      evmWalletAddress: purchasingWallet().address,
      caip2Network: "eip155:84532",
    });

    expect(result.isErr() && result.error).toContain("malformed row");
  });

  it("fails closed when a balance amount is longer than any real balance", async () => {
    // Max uint256 is 78 digits. A longer amount is not a balance, and the
    // bound keeps an unbounded digit string off the BigInt path.
    getX402WalletsBalanceMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          evmWalletId: "wallet_1",
          address: purchasingWallet().address,
          Balances: [
            walletBalance({
              native: { symbol: "ETH", decimals: 18, amount: "9".repeat(200) },
            }),
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402WalletBalances({
      evmWalletId: "wallet_1",
      evmWalletAddress: purchasingWallet().address,
      caip2Network: "eip155:84532",
    });

    expect(result.isErr() && result.error).toContain("malformed row");
  });

  it("returns an error when a validated balance row reports a chain failure", async () => {
    getX402WalletsBalanceMock.mockResolvedValue({
      data: {
        status: "success",
        data: {
          evmWalletId: "wallet_1",
          address: purchasingWallet().address,
          Balances: [
            walletBalance({ native: null, asset: null, error: "RPC failed" }),
          ],
        },
      },
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().getX402WalletBalances({
      evmWalletId: "wallet_1",
      evmWalletAddress: purchasingWallet().address,
      caip2Network: "eip155:84532",
    });

    expect(result.isErr() && result.error).toContain("chain error");
  });
});

describe("payX402", () => {
  /**
   * A node-legal `paymentIdentifier`, shaped like the one the pay service
   * actually sends: `${taskId}_${paymentId}`, both uuid(7).
   *
   * The node validates this field against `minLength: 16`, `maxLength: 128`
   * and `^[a-zA-Z0-9_-]+$` (`POST /x402/pay`, payment.openapi.json). The old
   * fixture was `"task_1:pay_1"` — 13 characters and a colon, so illegal on
   * both counts. The production join was fixed to use "_" precisely because a
   * colon 400s, and the pay flow treats a 400 as a refusal and refunds; a
   * fixture modelling the rejected shape re-teaches the bug it cost a fix to
   * remove.
   */
  const PAYMENT_IDENTIFIER =
    "0195c0f2-1a2b-7c3d-8e4f-5a6b7c8d9e0f_0195c0f2-3a4b-7c5d-8e6f-7a8b9c0d1e2f";

  const paymentRequired = {
    x402Version: 2 as const,
    accepts: [
      {
        // `as const` because the schema pins scheme to the literal "exact";
        // a widened `string` is not assignable to X402PaymentRequired.
        scheme: "exact" as const,
        network: "eip155:84532",
        asset: USDC_BASE_SEPOLIA,
        amount: "250000",
        payTo: "0x1111111111111111111111111111111111111111",
        maxTimeoutSeconds: 60,
      },
    ],
  };

  function signedPayment(overrides: Record<string, unknown> = {}) {
    return {
      attemptId: "attempt_1",
      payer: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
      caip2Network: "eip155:84532",
      asset: USDC_BASE_SEPOLIA,
      amount: "250000",
      payTo: "0x1111111111111111111111111111111111111111",
      xPaymentHeader: "aGVhZGVy",
      paymentPayload: { payload: { authorization: { nonce: "0xabc" } } },
      paymentPayloadHash: "0xhash",
      paymentIdentifier: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the signed payment and forwards the full request body", async () => {
    const data = signedPayment();
    postX402PayMock.mockResolvedValue({
      data: { status: "success", data },
      error: undefined,
      response: { status: 200 },
    });
    const signal = new AbortController().signal;

    const result = await createClient().payX402(
      {
        evmWalletId: "wallet_1",
        paymentRequired,
        preferredNetwork: "eip155:84532",
        preferredAsset: USDC_BASE_SEPOLIA,
        paymentIdentifier: PAYMENT_IDENTIFIER,
      },
      { signal },
    );

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value).toEqual(data);
    expect(postX402PayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          evmWalletId: "wallet_1",
          paymentRequired,
          preferredNetwork: "eip155:84532",
          preferredAsset: USDC_BASE_SEPOLIA,
          paymentIdentifier: PAYMENT_IDENTIFIER,
        },
        signal,
      }),
    );
  });

  it("omits optional keys the caller did not set instead of sending undefined", async () => {
    // The node 400s a paymentIdentifier sent against a 402 that does not
    // advertise the extension (ticket 011 Q2) — the caller's gate only works
    // if an unset identifier is truly absent from the body.
    postX402PayMock.mockResolvedValue({
      data: { status: "success", data: signedPayment() },
      error: undefined,
      response: { status: 200 },
    });

    await createClient().payX402({ evmWalletId: "wallet_1", paymentRequired });

    const body = postX402PayMock.mock.calls[0]?.[0]?.body as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).toEqual(["evmWalletId", "paymentRequired"]);
  });

  it("maps documented node refusal statuses to a refusal carrying the status and message", async () => {
    // Ticket 011 Q1 enumerates the node handler's own pre-header statuses.
    // Only these statuses plus its envelope prove no authorization was signed.
    for (const status of [400, 402, 500]) {
      postX402PayMock.mockResolvedValue({
        data: undefined,
        error: { error: { message: "budget exhausted" } },
        response: { status },
      });

      const result = await createClient().payX402({
        evmWalletId: "wallet_1",
        paymentRequired,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("refused");
        expect(result.error.status).toBe(status);
        expect(result.error.message).toBe(
          `x402 pay refused (status ${status}): budget exhausted`,
        );
      }
    }
  });

  it("treats a gateway status without the node's error envelope as ambiguous", async () => {
    // The doctrine's premise — non-200 implies no header was issued — holds
    // for the NODE's own statuses, which the spec enumerates as 400/402/500.
    // A 502/503/504/408 from a reverse proxy or load balancer in front of the
    // node is a different animal entirely: it can be produced AFTER the node
    // signed, and it is indistinguishable here by status alone.
    //
    // Classifying it "refused" triggers the synchronous refund and a terminal
    // FAILED against a live, undelivered authorization; the same-key replay
    // then 409s and tells the coworker to mint a new key, which charges and
    // signs a SECOND time. No user fund loss, but it is a doctrine violation
    // in the direction the doctrine forbids, plus node-budget burn.
    //
    // So the node's own envelope is required before "refused" is claimed.
    for (const [status, body] of [
      [502, "<html><body>502 Bad Gateway</body></html>"],
      [503, { message: "Service Unavailable" }],
      [504, undefined],
      [408, { error: "Request Timeout" }],
    ] as const) {
      postX402PayMock.mockResolvedValue({
        data: undefined,
        error: body,
        response: { status },
      });

      const result = await createClient().payX402({
        evmWalletId: "wallet_1",
        paymentRequired,
      });

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.kind).toBe("ambiguous");
      expect(result.isErr() && result.error.status).toBe(status);
    }
  });

  it("treats gateway statuses as ambiguous even when their body mimics the node envelope", async () => {
    for (const status of [408, 502, 503, 504]) {
      postX402PayMock.mockResolvedValue({
        data: undefined,
        error: { error: { message: "upstream unavailable" } },
        response: { status },
      });

      const result = await createClient().payX402({
        evmWalletId: "wallet_1",
        paymentRequired,
      });

      expect(result.isErr() && result.error.kind).toBe("ambiguous");
      expect(result.isErr() && result.error.status).toBe(status);
    }
  });

  it("treats even a node-shaped status as ambiguous when the envelope is absent", async () => {
    // The rule is the ENVELOPE, not the status list. A 500 rendered as an HTML
    // error page did not come from the node's own handler, so it says nothing
    // about whether a header exists.
    postX402PayMock.mockResolvedValue({
      data: undefined,
      error: "<html>500</html>",
      response: { status: 500 },
    });

    const result = await createClient().payX402({
      evmWalletId: "wallet_1",
      paymentRequired,
    });

    expect(result.isErr() && result.error.kind).toBe("ambiguous");
  });

  it("carries the node's own error.message alongside a refusal", async () => {
    // The caller echoes the node's text back to the coworker on a 400 ("your
    // payload is the problem") while withholding it on 402/500. That echo must
    // be the node's OWN message and never `extractNodeErrorMessage`'s
    // JSON.stringify fallback, which dumps the whole response body and can
    // carry wallet or budget internals — exactly what the sibling branch
    // protects.
    postX402PayMock.mockResolvedValue({
      data: undefined,
      error: { error: { message: "accepts[0].payTo is not registered" } },
      response: { status: 400 },
    });

    const result = await createClient().payX402({
      evmWalletId: "wallet_1",
      paymentRequired,
    });

    expect(result.isErr() && result.error.kind).toBe("refused");
    expect(result.isErr() && result.error.nodeMessage).toBe(
      "accepts[0].payTo is not registered",
    );
  });

  it("treats a 200 without usable data as ambiguous, never as a refusal", async () => {
    // A header may have been issued that was lost in transit — still
    // unsettleable from the buyer's side, but not provably refused.
    postX402PayMock.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: { status: 200 },
    });

    const result = await createClient().payX402({
      evmWalletId: "wallet_1",
      paymentRequired,
    });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.kind).toBe("ambiguous");
  });

  it("treats a 200 with an incomplete signed payload as ambiguous, never signed", async () => {
    // A version-skewed node answering 200 with a signed-tuple field
    // missing/empty must NOT flow through as SIGNED — finalizing it would
    // write VERIFIED with a null header, which the route can never serialize,
    // every replay 500s forever, and refund refuses a VERIFIED row. A
    // maybe-signed 200 stays ambiguous (never refused, so never an inline
    // refund; ticket 011 Q1's safety is non-200 only).
    for (const partial of [
      { xPaymentHeader: "" }, // present key, empty header
      { xPaymentHeader: undefined }, // header key absent
      { attemptId: "" }, // present key, empty attemptId
      { attemptId: undefined }, // attemptId key absent
      { payTo: undefined }, // signed-tuple field absent
      { amount: "" }, // signed-tuple field empty
      { caip2Network: undefined }, // signed-tuple field absent
      { asset: "" }, // signed-tuple field empty
      // `payer` writes TaskX402Payment.payerAddress. Prisma treats undefined
      // as "skip", so an absent payer silently leaves that column NULL — and
      // Postgres NULLs are distinct, which disables the partial
      // [caip2Network, asset, payerAddress, payloadNonce] nonce-replay unique
      // for the row. Absence must be caught here, not written as a hole.
      { payer: undefined },
      { payer: "" },
      // Finalize persists this observation. Missing/empty values must stay an
      // ambiguous 200, not become a VERIFIED row with a runtime-created hole.
      { paymentPayloadHash: undefined },
      { paymentPayloadHash: "" },
      // `paymentPayload` is dereferenced downstream. An absent one is a
      // TypeError — an unhandled 500 that leaves the row PENDING with the
      // charge held and throws away the header the node did issue.
      { paymentPayload: undefined },
      { paymentPayload: null },
      { paymentPayload: "not-an-object" },
    ]) {
      postX402PayMock.mockResolvedValue({
        data: { status: "success", data: signedPayment(partial) },
        error: undefined,
        response: { status: 200 },
      });

      const result = await createClient().payX402({
        evmWalletId: "wallet_1",
        paymentRequired,
      });

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.kind).toBe("ambiguous");
    }
  });

  it("treats a thrown transport error as ambiguous", async () => {
    postX402PayMock.mockRejectedValue(new Error("socket hang up"));

    const result = await createClient().payX402({
      evmWalletId: "wallet_1",
      paymentRequired,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("ambiguous");
      expect(result.error.message).toMatch(/socket hang up/);
    }
  });
});
