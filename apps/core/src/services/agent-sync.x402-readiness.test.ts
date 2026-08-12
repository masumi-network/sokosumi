import type { CreditCost } from "@sokosumi/database";
import type { X402AvailableNetwork, X402Budget } from "@sokosumi/masumi";
import { convertCreditsToCents } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { calculateCentsFromX402Amount } from "@/helpers/x402-pricing";
import {
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
} from "@/helpers/x402-readiness";

const {
  captureExceptionMock,
  captureMessageMock,
  getX402AvailableNetworksMock,
  getX402BudgetsMock,
  syncMetadataCreateManyMock,
  syncMetadataDeleteManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  getX402AvailableNetworksMock: vi.fn(),
  getX402BudgetsMock: vi.fn(),
  syncMetadataCreateManyMock: vi.fn(),
  syncMetadataDeleteManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    NETWORK: "Preprod",
    DATABASE_URL: "https://example.com/database",
  }),
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    getX402AvailableNetworks: getX402AvailableNetworksMock,
    getX402Budgets: getX402BudgetsMock,
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    syncMetadata: {
      createMany: syncMetadataCreateManyMock,
      deleteMany: syncMetadataDeleteManyMock,
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
  },
}));

import {
  composeX402ReadySources,
  syncX402BuySideReadiness,
} from "./agent-sync.x402-readiness";

const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase();

function availableNetwork(
  overrides: Partial<X402AvailableNetwork> = {},
): X402AvailableNetwork {
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

function budget(overrides: Partial<X402Budget> = {}): X402Budget {
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

const READY_SOURCE = {
  caip2Network: "eip155:84532",
  asset: USDC_BASE_SEPOLIA,
  evmWalletId: "wallet_1",
  decimals: 6,
};

const BASE_MAINNET_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function mainnetNetwork(
  overrides: Partial<X402AvailableNetwork> = {},
): X402AvailableNetwork {
  return availableNetwork({
    id: "x402net_2",
    caip2Id: "eip155:8453",
    isTestnet: false,
    defaultAsset: BASE_MAINNET_USDC,
    ...overrides,
  });
}

function mainnetBudget(overrides: Partial<X402Budget> = {}): X402Budget {
  return budget({
    id: "x402budget_mainnet",
    caip2Network: "eip155:8453",
    asset: BASE_MAINNET_USDC,
    ...overrides,
  });
}

describe("composeX402ReadySources", () => {
  it("pairs an enabled network with a funded budget", () => {
    expect(
      composeX402ReadySources([availableNetwork()], [budget()], "Preprod"),
    ).toEqual([READY_SOURCE]);
  });

  it("drops budgets on disabled or unknown networks", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ isEnabled: false })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [budget({ caip2Network: "eip155:8453" })],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("drops exhausted and malformed budgets", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [
          budget({ remainingAmount: "0" }),
          budget({ remainingAmount: "-5" }),
          budget({ remainingAmount: "not-a-number" }),
          budget({ asset: "USDC" }),
          // Without a backing wallet id the pay route cannot sign — the
          // pair must not be recorded ready.
          budget({ evmWalletId: "" }),
        ],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("records the most-funded wallet when several budgets back one pair", () => {
    const result = composeX402ReadySources(
      [availableNetwork()],
      [
        budget({ id: "b1", evmWalletId: "wallet_small", remainingAmount: "5" }),
        budget({
          id: "b2",
          evmWalletId: "wallet_large",
          remainingAmount: "9000000",
        }),
        budget({ id: "b3", evmWalletId: "wallet_1", remainingAmount: "100" }),
      ],
      "Preprod",
    );

    expect(result).toEqual([{ ...READY_SOURCE, evmWalletId: "wallet_large" }]);
  });

  it("tie-breaks equal budgets on the wallet id deterministically", () => {
    const result = composeX402ReadySources(
      [availableNetwork()],
      [
        budget({ id: "b1", evmWalletId: "wallet_b", remainingAmount: "100" }),
        budget({ id: "b2", evmWalletId: "wallet_a", remainingAmount: "100" }),
      ],
      "Preprod",
    );

    expect(result).toEqual([{ ...READY_SOURCE, evmWalletId: "wallet_a" }]);
  });

  it("drops a mainnet pair on Preprod even when the node offers it", () => {
    // Environment separation must not rest on the node honouring
    // `query: { isTestnet }`. A node that ignores or misreads that filter
    // would otherwise put a Base MAINNET pair — real funds — into the
    // Preprod readiness cache.
    const result = composeX402ReadySources(
      [availableNetwork({ caip2Id: "EIP155:84532" }), mainnetNetwork()],
      [
        budget({
          asset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
        }),
        budget({ id: "x402budget_2" }),
        mainnetBudget(),
      ],
      "Preprod",
    );

    // Casing normalized, duplicates collapsed, mainnet gone.
    expect(result).toEqual([READY_SOURCE]);
  });

  it("drops a testnet pair on Mainnet and keeps the mainnet one", () => {
    const result = composeX402ReadySources(
      [availableNetwork(), mainnetNetwork()],
      [budget(), mainnetBudget()],
      "Mainnet",
    );

    expect(result).toEqual([
      {
        caip2Network: "eip155:8453",
        asset: BASE_MAINNET_USDC,
        evmWalletId: "wallet_1",
        decimals: 6,
      },
    ]);
  });

  it("drops a funded budget in an asset the node publishes no decimals for", () => {
    // The node publishes decimals for its DEFAULT asset only, so a budget in
    // any other asset has no trustworthy scale anywhere — the only other
    // source is the agent's own registry entry, which is exactly the input
    // this pair stops trusting. Pricing needs the scale (`cents = amount x
    // centsPerUnit / 10^decimals`), so an asset without one is not payable.
    const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
    const result = composeX402ReadySources(
      [mainnetNetwork()],
      [mainnetBudget({ id: "x402budget_usdt", asset: usdt }), mainnetBudget()],
      "Mainnet",
    );

    expect(result.map((source) => source.asset)).toEqual([BASE_MAINNET_USDC]);
  });

  it("carries the node's decimals onto the recorded pair", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAssetDecimals: 8 })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([{ ...READY_SOURCE, decimals: 8 }]);
  });

  it("matches the node's default asset canonically, not by raw spelling", () => {
    // The node may serve a checksummed address while the budget is lowercase
    // (or the reverse). Both sides are canonicalized before comparing, or a
    // spelling difference would silently unlist the one payable pair.
    expect(
      composeX402ReadySources(
        [
          availableNetwork({
            defaultAsset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
          }),
        ],
        [budget()],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });

  it("drops the pair when the node reports no usable decimals", () => {
    // Fail closed rather than guessing or falling back to the agent's
    // registered value: `defaultAssetDecimals` is nullable in the node's spec
    // ("null until an operator confirms them"), and a wrong scale mis-prices
    // by 10^n.
    for (const defaultAssetDecimals of [null, 6.5, -1, 256, Number.NaN]) {
      expect(
        composeX402ReadySources(
          [availableNetwork({ defaultAssetDecimals })],
          [budget()],
          "Preprod",
        ),
      ).toEqual([]);
    }
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: null })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork({ defaultAsset: "USDC" })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
  });

  it("drops a network the node lists twice with disagreeing decimals", () => {
    // Two entries for one chain is malformed. Picking either one is picking
    // a charge scale at random — and one of the two is 10^n wrong.
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ defaultAssetDecimals: 18 })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([]);
    // Agreeing duplicates are one network, not a conflict.
    expect(
      composeX402ReadySources(
        [availableNetwork(), availableNetwork({ id: "x402net_dup" })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });

  it("prices off the node's decimals, never the agent-registered ones", () => {
    // The exploit this pair exists to close. `decimals` scales the charge
    // INVERSELY, and the agent authors its own registry entry: registering
    // USDC on Base Sepolia with decimals 18 (true value 6) makes a demand for
    // 1 whole USDC price at the platform floor while Soko's managed wallet
    // signs away a real USDC.
    const [source] = composeX402ReadySources(
      [availableNetwork()],
      [budget()],
      "Preprod",
    );
    if (!source) {
      expect.unreachable("the funded pair must be recorded");
    }

    const creditCosts: CreditCost[] = [
      {
        id: "credit-cost-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        unit: `eip155:84532/erc20:${USDC_BASE_SEPOLIA}`,
        // 1 whole USDC = 1 credit = 10^10 cents.
        centsPerUnit: 10_000_000_000n,
      },
    ];
    const oneWholeUsdc = "1000000";
    const AGENT_AUTHORED_DECIMALS = 18;

    const trustedCents = calculateCentsFromX402Amount(
      {
        caip2Network: source.caip2Network,
        asset: source.asset,
        amount: oneWholeUsdc,
        decimals: source.decimals,
      },
      creditCosts,
    );
    const exploitedCents = calculateCentsFromX402Amount(
      {
        caip2Network: source.caip2Network,
        asset: source.asset,
        amount: oneWholeUsdc,
        decimals: AGENT_AUTHORED_DECIMALS,
      },
      creditCosts,
    );

    // The money first: 1 whole USDC must cost 1 credit.
    expect(trustedCents).toBe(10_000_000_000n);
    // What the agent's number would have charged instead — the platform
    // floor, a 10^10x under-charge, repeatable on every call while the
    // managed wallet signs away a real USDC each time.
    expect(exploitedCents).toBe(
      convertCreditsToCents(LIMITS.MIN_CHARGEABLE_CREDITS),
    );
    expect(source.decimals).toBe(6);
    expect(source.decimals).not.toBe(AGENT_AUTHORED_DECIMALS);
  });

  it("ignores canSettle — buy-side readiness needs no facilitator", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ canSettle: false })],
        [budget()],
        "Preprod",
      ),
    ).toEqual([READY_SOURCE]);
  });
});

describe("syncX402BuySideReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    syncMetadataDeleteManyMock.mockResolvedValue({ count: 0 });
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    syncMetadataUpsertMock.mockResolvedValue(undefined);
    getX402AvailableNetworksMock.mockResolvedValue(ok([availableNetwork()]));
    getX402BudgetsMock.mockResolvedValue(ok([budget()]));
  });

  it("caches composed ready pairs under the readiness key", async () => {
    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: X402_BUY_SIDE_READINESS_KEY },
      create: {
        key: X402_BUY_SIDE_READINESS_KEY,
        cursorId: JSON.stringify([READY_SOURCE]),
        lastSyncedAt: expect.any(Date),
      },
      update: {
        cursorId: JSON.stringify([READY_SOURCE]),
        lastSyncedAt: expect.any(Date),
      },
    });
    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: X402_BUY_SIDE_READINESS_FAILURE_KEY },
    });
  });

  it("never caches a pair outside this environment's allowlist", async () => {
    // End to end through the sync: NETWORK is Preprod (mocked above), so a
    // node reporting Base mainnet as available and funded must leave no
    // mainnet pair in the cache.
    getX402AvailableNetworksMock.mockResolvedValue(
      ok([availableNetwork(), mainnetNetwork()]),
    );
    getX402BudgetsMock.mockResolvedValue(ok([budget(), mainnetBudget()]));

    await syncX402BuySideReadiness();

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          cursorId: JSON.stringify([READY_SOURCE]),
        }),
      }),
    );
  });

  it("reports no change when the cache holds the same pair set", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: JSON.stringify([READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);
  });

  it("caches an empty list and pages on the transition to nothing ready", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402BudgetsMock.mockResolvedValue(ok([]));
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: JSON.stringify([READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: X402_BUY_SIDE_READINESS_KEY },
        update: expect.objectContaining({ cursorId: "[]" }),
      }),
    );
    expect(captureMessageMock).toHaveBeenCalledTimes(1);

    // A lasting nothing-ready state must not page again.
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: "[]",
      lastSyncedAt: new Date(),
    });
    await expect(syncX402BuySideReadiness()).resolves.toBe(false);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it("keeps the last cached value when either node check fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    for (const [networks, budgets] of [
      [err("networks down"), ok([budget()])],
      [ok([availableNetwork()]), err("budgets down")],
    ] as const) {
      syncMetadataUpsertMock.mockClear();
      syncMetadataCreateManyMock.mockClear();
      getX402AvailableNetworksMock.mockResolvedValue(networks);
      getX402BudgetsMock.mockResolvedValue(budgets);

      await expect(syncX402BuySideReadiness()).resolves.toBe(false);

      expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
      expect(syncMetadataCreateManyMock).toHaveBeenCalledWith({
        data: [
          {
            key: X402_BUY_SIDE_READINESS_FAILURE_KEY,
            cursorId: "failed",
            lastSyncedAt: expect.any(Date),
          },
        ],
        skipDuplicates: true,
      });
    }

    consoleWarnSpy.mockRestore();
  });

  it("reports a readiness failure to Sentry once per failure streak", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Warm: readiness HAS been recorded — one page per streak.
    syncMetadataFindUniqueMock.mockResolvedValue({
      key: X402_BUY_SIDE_READINESS_KEY,
      cursorId: JSON.stringify([READY_SOURCE]),
      lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
    });
    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));

    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "x402 buy-side readiness check failed: node unavailable",
      }),
      expect.objectContaining({ tags: { x402_readiness: "stale" } }),
    );

    // A different process loses the atomic insert race and dedupes.
    syncMetadataCreateManyMock.mockResolvedValue({ count: 0 });
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it("keeps paging while readiness has never been recorded (cold start)", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Cold: no readiness row has ever been written, so getX402ReadySources
    // returns [] and the ENTIRE x402 listing is hidden. The one-shot latch
    // would spend its single page minutes after deploy and then go quiet —
    // never-recorded must bypass it.
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    getX402BudgetsMock.mockResolvedValue(err("node unavailable"));

    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("has never been recorded"),
      }),
      expect.objectContaining({
        tags: { x402_readiness: "never_recorded" },
      }),
    );

    // The latch is now held, which would silence a warm failure. Cold pages
    // anyway.
    syncMetadataCreateManyMock.mockResolvedValue({ count: 0 });
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);

    consoleWarnSpy.mockRestore();
  });

  it("re-arms the Sentry report after a successful check", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Warm from the start: a readiness row exists, so every failure below
    // takes the latched (stale) path — never the cold-start bypass. The
    // latch alone decides who pages, which is what this test proves.
    syncMetadataFindUniqueMock.mockResolvedValue({
      key: X402_BUY_SIDE_READINESS_KEY,
      cursorId: JSON.stringify([READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: { x402_readiness: "stale" } }),
    );

    // While the marker row is held, further warm failures stay silent.
    syncMetadataCreateManyMock.mockResolvedValue({ count: 0 });
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // A successful check deletes the marker …
    getX402AvailableNetworksMock.mockResolvedValue(ok([availableNetwork()]));
    await syncX402BuySideReadiness();
    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: X402_BUY_SIDE_READINESS_FAILURE_KEY },
    });

    // … so the next failure's createMany inserts a fresh marker (count 1)
    // and pages again: the re-armed latch, not the cold-start bypass.
    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: { x402_readiness: "stale" } }),
    );

    consoleWarnSpy.mockRestore();
  });

  it("does not crash the sync loop when the failure marker cannot be stored", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));
    syncMetadataCreateManyMock.mockRejectedValue(new Error("database down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Failed to persist x402 readiness failure marker:",
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("does not crash the sync loop when the readiness cache cannot be read", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    syncMetadataFindUniqueMock.mockRejectedValue(new Error("database down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Failed to persist x402 buy-side readiness:",
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("does not crash the sync loop when the readiness cache cannot be written", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    syncMetadataUpsertMock.mockRejectedValue(new Error("database down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(syncMetadataDeleteManyMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Failed to persist x402 buy-side readiness:",
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("keeps a readiness change when failure-marker cleanup fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    syncMetadataDeleteManyMock.mockRejectedValue(new Error("database down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Failed to clear x402 readiness failure marker:",
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("forwards the abort signal to both node checks", async () => {
    const signal = new AbortController().signal;

    await syncX402BuySideReadiness({ signal });

    expect(getX402AvailableNetworksMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(getX402BudgetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });
});
