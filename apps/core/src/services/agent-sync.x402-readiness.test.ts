import type { X402AvailableNetwork, X402Budget } from "@sokosumi/masumi";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
};

describe("composeX402ReadySources", () => {
  it("pairs an enabled network with a funded budget", () => {
    expect(composeX402ReadySources([availableNetwork()], [budget()])).toEqual([
      READY_SOURCE,
    ]);
  });

  it("drops budgets on disabled or unknown networks", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ isEnabled: false })],
        [budget()],
      ),
    ).toEqual([]);
    expect(
      composeX402ReadySources(
        [availableNetwork()],
        [budget({ caip2Network: "eip155:8453" })],
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
        ],
      ),
    ).toEqual([]);
  });

  it("normalizes casing, dedupes, and sorts deterministically", () => {
    const baseMainnetUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const result = composeX402ReadySources(
      [
        availableNetwork({ caip2Id: "EIP155:84532" }),
        availableNetwork({
          id: "x402net_2",
          caip2Id: "eip155:8453",
          isTestnet: false,
        }),
      ],
      [
        budget({
          asset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
        }),
        budget({ id: "x402budget_2" }),
        budget({
          id: "x402budget_3",
          caip2Network: "eip155:8453",
          asset: baseMainnetUsdc,
        }),
      ],
    );

    expect(result).toEqual([
      { caip2Network: "eip155:8453", asset: baseMainnetUsdc },
      READY_SOURCE,
    ]);
  });

  it("ignores canSettle — buy-side readiness needs no facilitator", () => {
    expect(
      composeX402ReadySources(
        [availableNetwork({ canSettle: false })],
        [budget()],
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

    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    getX402AvailableNetworksMock.mockResolvedValue(ok([availableNetwork()]));
    await syncX402BuySideReadiness();
    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: X402_BUY_SIDE_READINESS_FAILURE_KEY },
    });

    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    getX402AvailableNetworksMock.mockResolvedValue(err("node unavailable"));
    await syncX402BuySideReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);

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
