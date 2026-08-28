import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
} from "@/helpers/x402-readiness";

const {
  captureExceptionMock,
  captureMessageMock,
  envState,
  getX402AvailableNetworksMock,
  getX402KeySpendCapsMock,
  getX402PurchasingWalletsMock,
  getX402WalletBalancesMock,
  syncMetadataCreateManyMock,
  syncMetadataDeleteManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  envState: {
    NETWORK: "Preprod" as const,
    DATABASE_URL: "https://example.com/database",
    VERCEL_ENV: undefined as
      | "production"
      | "preview"
      | "development"
      | undefined,
  },
  getX402AvailableNetworksMock: vi.fn(),
  getX402KeySpendCapsMock: vi.fn(),
  getX402PurchasingWalletsMock: vi.fn(),
  getX402WalletBalancesMock: vi.fn(),
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
  getEnv: () => ({ ...envState }),
}));

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    getX402AvailableNetworks: getX402AvailableNetworksMock,
    getX402KeySpendCaps: getX402KeySpendCapsMock,
    getX402PurchasingWallets: getX402PurchasingWalletsMock,
    getX402WalletBalances: getX402WalletBalancesMock,
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
  boundCheckErrorForLogging,
  syncX402BuySideReadiness,
} from "./agent-sync.x402-readiness";
import {
  availableNetwork,
  cappedWith,
  fundedWalletBalances,
  keySpendCaps,
  mainnetNetwork,
  PURCHASING_WALLET_ADDRESS,
  purchasingWallet,
  READY_SOURCE,
  USDC_BASE_SEPOLIA,
} from "./agent-sync.x402-readiness.fixtures";

describe("syncX402BuySideReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.VERCEL_ENV = undefined;
    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    syncMetadataDeleteManyMock.mockResolvedValue({ count: 0 });
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    syncMetadataUpsertMock.mockResolvedValue(undefined);
    getX402AvailableNetworksMock.mockResolvedValue(ok([availableNetwork()]));
    getX402PurchasingWalletsMock.mockResolvedValue(ok([purchasingWallet()]));
    getX402KeySpendCapsMock.mockResolvedValue(ok(keySpendCaps()));
    getX402WalletBalancesMock.mockResolvedValue(ok(fundedWalletBalances()));
  });

  it("caches nothing when the key is capped with no credits for the pair", async () => {
    // End to end through the sync: the wallet is listed and funded, so only
    // the key's spend cap can stop this pair. A capped key at zero cannot pay,
    // and listed must mean payable.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402KeySpendCapsMock.mockResolvedValue(ok(cappedWith(0n)));

    await syncX402BuySideReadiness();

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ cursorId: "[]" }),
      }),
    );
    consoleWarnSpy.mockRestore();
  });

  it("caches the pair when the capped key still holds credits for it", async () => {
    getX402KeySpendCapsMock.mockResolvedValue(ok(cappedWith(1_000_000n)));

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          cursorId: JSON.stringify([READY_SOURCE]),
        }),
      }),
    );
  });

  it("caches an uncapped wallet as ready", async () => {
    getX402PurchasingWalletsMock.mockResolvedValue(ok([purchasingWallet()]));

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          cursorId: JSON.stringify([
            {
              ...READY_SOURCE,
              evmWalletId: "wallet_admin",
              evmWalletAddress: PURCHASING_WALLET_ADDRESS,
            },
          ]),
        }),
      }),
    );
    expect(getX402WalletBalancesMock).toHaveBeenCalledWith(
      {
        evmWalletId: "wallet_admin",
        evmWalletAddress: purchasingWallet().address,
        caip2Network: "eip155:84532",
      },
      { signal: undefined },
    );
  });

  it.each([
    ["native gas", { native: { symbol: "ETH", decimals: 18, amount: "0" } }],
    [
      "default token",
      {
        asset: {
          asset: USDC_BASE_SEPOLIA,
          symbol: "USDC",
          decimals: 6,
          amount: "0",
        },
      },
    ],
  ])(
    "does not cache an admin wallet with no %s balance",
    async (_label, overrides) => {
      getX402PurchasingWalletsMock.mockResolvedValue(ok([purchasingWallet()]));
      getX402WalletBalancesMock.mockResolvedValue(
        ok(fundedWalletBalances(overrides)),
      );

      await expect(syncX402BuySideReadiness()).resolves.toBe(true);

      expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ cursorId: "[]" }),
        }),
      );
    },
  );

  it("keeps cached readiness when a required balance lookup fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402PurchasingWalletsMock.mockResolvedValue(ok([purchasingWallet()]));
    getX402WalletBalancesMock.mockResolvedValue(err("balance down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataCreateManyMock).toHaveBeenCalledTimes(1);
    consoleWarnSpy.mockRestore();
  });

  it("never balance-fetches a chain compose would refuse (untrusted default asset)", async () => {
    // The balance-eligibility sweep uses the SAME gate as compose. If it
    // were a looser hand-copy, a chain with an untrusted default asset (or
    // contradictory rows) would still have its wallets balance-fetched, and
    // any error from those fetches would fail the whole check — keeping a
    // STALE previously-ready pair being served exactly when the current
    // node state would delist it.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402AvailableNetworksMock.mockResolvedValue(
      ok([
        availableNetwork({
          defaultAsset: "0x1111111111111111111111111111111111111111",
        }),
      ]),
    );
    getX402PurchasingWalletsMock.mockResolvedValue(ok([purchasingWallet()]));
    // A flaky balance backend must be irrelevant: the sweep never asks.
    getX402WalletBalancesMock.mockResolvedValue(err("balance down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(getX402WalletBalancesMock).not.toHaveBeenCalled();
    // The check SUCCEEDS and records the delisting instead of failing and
    // serving the stale cache.
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ cursorId: "[]" }),
      }),
    );
    consoleWarnSpy.mockRestore();
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
    getX402PurchasingWalletsMock.mockResolvedValue(
      ok([
        purchasingWallet(),
        purchasingWallet({
          id: "wallet_mainnet",
          caip2Network: "eip155:8453",
        }),
      ]),
    );

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
    getX402PurchasingWalletsMock.mockResolvedValue(ok([]));
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
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Empty x402 readiness inputs:",
      {
        networkCount: 1,
        networks: [
          {
            caip2Id: "eip155:84532",
            isEnabled: true,
            defaultAsset: USDC_BASE_SEPOLIA,
            defaultAssetDecimals: 6,
          },
        ],
        usageLimited: false,
        grandfatheredUncapped: false,
        creditUnits: [],
        purchasingWalletCount: 0,
        purchasingWalletNetworks: [],
        truncated: false,
      },
    );

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

    for (const [networks, caps, wallets] of [
      [err("networks down"), ok(keySpendCaps()), ok([])],
      [ok([availableNetwork()]), err("spend caps down"), ok([])],
      [ok([availableNetwork()]), ok(keySpendCaps()), err("wallets down")],
    ] as const) {
      syncMetadataUpsertMock.mockClear();
      syncMetadataCreateManyMock.mockClear();
      getX402AvailableNetworksMock.mockResolvedValue(networks);
      getX402KeySpendCapsMock.mockResolvedValue(caps);
      getX402PurchasingWalletsMock.mockResolvedValue(wallets);

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

  it("keeps cached readiness when wallet discovery fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getX402PurchasingWalletsMock.mockResolvedValue(err("wallets down"));

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataCreateManyMock).toHaveBeenCalledTimes(1);
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

  it("bounds far-side error text before paging so one fat body cannot crowd out later errors", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    syncMetadataFindUniqueMock.mockResolvedValue({
      key: X402_BUY_SIDE_READINESS_KEY,
      cursorId: JSON.stringify([READY_SOURCE]),
      lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
    });
    // extractNodeErrorMessage can stringify an entire proxy body; unbounded,
    // the Sentry SDK's own truncation would then drop "spend caps down" from
    // the page entirely.
    getX402AvailableNetworksMock.mockResolvedValue(err("x".repeat(10_000)));
    getX402KeySpendCapsMock.mockResolvedValue(err("spend caps down"));

    await syncX402BuySideReadiness();

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [pagedError] = captureExceptionMock.mock.calls[0] as [Error];
    expect(pagedError.message.length).toBeLessThan(2_500);
    expect(pagedError.message).toContain("spend caps down");

    consoleWarnSpy.mockRestore();
  });

  it("caps the joined error line even when many bounded items accumulate", () => {
    // The total cap is unreachable through syncX402BuySideReadiness without
    // fabricating dozens of erring wallet balance fetches (the reachable
    // worst case: ~99 balance-eligible wallets each erring), so pin the
    // bounding function directly: per-item slicing alone must not be enough.
    const bounded = boundCheckErrorForLogging(
      Array.from({ length: 30 }, (_, index) => `${index}:${"x".repeat(300)}`),
    );
    expect(bounded.length).toBe(2_000);
    // Items past the first survive the per-item cap (the cap's purpose)...
    expect(bounded).toContain("; 1:");
    // ...and each item was individually sliced before the join.
    expect(bounded.indexOf("; 1:")).toBeLessThan(210);
  });

  it("redacts an env secret the far side echoed back", () => {
    // The exposure this closes: extractNodeErrorMessage falls back to a JSON
    // dump of the whole response body, so a proxy in front of the node that
    // answers with the request headers echoed hands our own PAYMENT_API_KEY
    // back to us. That string goes to stdout AND into a Sentry message.
    const key = process.env.PAYMENT_API_KEY as string;

    const bounded = boundCheckErrorForLogging([
      `api-key-status 502: {"headers":{"token":"${key}"}}`,
    ]);

    expect(bounded).not.toContain(key);
    expect(bounded).toContain("[redacted:env-secret]");
  });

  it("redacts before truncating, so a halved key cannot survive", () => {
    // Order matters on its own. The per-item cap is 200 characters, so a key
    // starting at 195 is cut in half by the slice; five characters of key
    // material is still key material. Redacting first removes it whole.
    const key = process.env.PAYMENT_API_KEY as string;

    const bounded = boundCheckErrorForLogging([`${"x".repeat(195)}${key}`]);

    expect(bounded).not.toContain(key.slice(0, 5));
    // The marker itself is what the slice cuts now, not the key.
    expect(bounded).toContain("[red");
  });

  it("keeps paging while readiness has never been recorded (cold start)", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Cold: no readiness row has ever been written, so getX402ReadySources
    // returns [] and the ENTIRE x402 listing is hidden. The one-shot latch
    // would spend its single page minutes after deploy and then go quiet —
    // never-recorded must bypass it. Production (and unset VERCEL_ENV) must
    // still page — including the latch bypass.
    envState.VERCEL_ENV = "production";
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    getX402KeySpendCapsMock.mockResolvedValue(err("node unavailable"));

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

  it("does not page Sentry for readiness check failures on Vercel preview", async () => {
    // Preview mainnet Core crons hit the same never-recorded path with a
    // non-admin PAYMENT_API_KEY and were paging CORE-37 as a fake prod
    // outage. Gate only captureException — warn + failure marker +
    // fail-closed (no readiness row) stay.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    envState.VERCEL_ENV = "preview";
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    getX402KeySpendCapsMock.mockResolvedValue(
      err("api-key-status 401: Unauthorized"),
    );

    await expect(syncX402BuySideReadiness()).resolves.toBe(false);

    expect(captureExceptionMock).not.toHaveBeenCalled();
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
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] x402 buy-side readiness check failed:",
      expect.stringContaining("api-key-status 401"),
    );

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

  it("pages when failure-marker cleanup fails (the alert latch is disarming)", async () => {
    // While a stale marker survives, the createMany latch reports count=0 for
    // every NEW failure streak — the next real outage would page nobody. A
    // cleanup failure must therefore be loud, not only a log line.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const cleanupError = new Error("database down");
    syncMetadataDeleteManyMock.mockRejectedValue(cleanupError);

    await expect(syncX402BuySideReadiness()).resolves.toBe(true);

    expect(captureExceptionMock).toHaveBeenCalledWith(cleanupError, {
      tags: { x402_readiness: "marker_cleanup_failed" },
    });
    consoleWarnSpy.mockRestore();
  });

  // Every node call, not just the two the sync fires first. A cycle aborts on
  // shutdown, and a call that never receives the signal keeps its request
  // alive past that abort. The wallet listing and the per-wallet balance
  // fetches count too, and those are the calls that fan out.
  it("forwards the abort signal to every node call", async () => {
    const signal = new AbortController().signal;

    await syncX402BuySideReadiness({ signal });

    expect(getX402AvailableNetworksMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(getX402KeySpendCapsMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(getX402PurchasingWalletsMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(getX402WalletBalancesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal }),
    );
  });
});
