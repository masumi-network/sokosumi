import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  findX402ReadySource,
  getAllowedX402Caip2Networks,
  getX402ReadySources,
  isX402NetworkAllowed,
  X402_BUY_SIDE_READINESS_KEY,
} from "./x402-readiness";

const { getEnvMock } = vi.hoisted(() => ({
  // Default is set here (not only in beforeEach) because `@/lib/db/prisma`
  // reads getEnv().DATABASE_URL at module load, before any hook runs.
  getEnvMock: vi.fn().mockReturnValue({
    DATABASE_URL: "https://example.com/database",
    NETWORK: "Preprod",
  }),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase();

const X402_READY_SOURCE = {
  caip2Network: "eip155:84532",
  asset: USDC_BASE_SEPOLIA,
  evmWalletId: "wallet_1",
  decimals: 6,
};

describe("getX402ReadySources", () => {
  function createSyncMetadataTransactionClient(
    row: { cursorId: string; lastSyncedAt: Date } | null,
  ) {
    const findUnique = vi.fn().mockResolvedValue(row);
    const tx = {
      syncMetadata: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, findUnique };
  }

  it("returns exact pairs from a fresh cache row", async () => {
    const { tx, findUnique } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([X402_READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: X402_BUY_SIDE_READINESS_KEY },
    });
  });

  it("returns no pairs when the cached readiness is empty", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: "[]",
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([]);
  });

  it("returns no pairs when no readiness row exists yet (fail closed)", async () => {
    const { tx } = createSyncMetadataTransactionClient(null);

    await expect(getX402ReadySources(tx)).resolves.toEqual([]);
  });

  it("keeps serving readiness that has not been refreshed for a long time", async () => {
    // Last-known-value semantics: our cron falling behind must not take the
    // x402 listing down. A node that truly cannot pay refuses the sign, and
    // that refusal refunds synchronously.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([X402_READY_SOURCE]),
      lastSyncedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
  });

  it("fails closed for a non-array payload", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: "ready",
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([]);
  });

  it("drops cached pairs with malformed networks, assets, or missing wallets", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        { ...X402_READY_SOURCE, caip2Network: "base-sepolia" },
        { ...X402_READY_SOURCE, asset: "USDC" },
        { caip2Network: "eip155:84532", evmWalletId: "wallet_1" },
        // Rows cached before evmWalletId existed (or with it emptied) are
        // unsignable and must not be served.
        { caip2Network: "eip155:84532", asset: USDC_BASE_SEPOLIA },
        { ...X402_READY_SOURCE, evmWalletId: "" },
        { ...X402_READY_SOURCE, evmWalletId: "   " },
        X402_READY_SOURCE,
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
  });

  it("trims surrounding whitespace from a cached wallet id", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        { ...X402_READY_SOURCE, evmWalletId: "  wallet_1  " },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
  });

  it("preserves mixed-case cached wallet ids", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        { ...X402_READY_SOURCE, evmWalletId: "Wallet_1" },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([
      { ...X402_READY_SOURCE, evmWalletId: "Wallet_1" },
    ]);
  });

  it("drops cached pairs whose decimals are missing or out of range", async () => {
    // Decimals scale the charge INVERSELY, so an unusable value must never be
    // guessed at or fall back to the agent-registered number. A row cached
    // before the field existed is dropped like a walletless one: unusable
    // until the next sync rewrites the cache.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        {
          caip2Network: X402_READY_SOURCE.caip2Network,
          asset: X402_READY_SOURCE.asset,
          evmWalletId: X402_READY_SOURCE.evmWalletId,
        },
        { ...X402_READY_SOURCE, decimals: null },
        { ...X402_READY_SOURCE, decimals: "6" },
        { ...X402_READY_SOURCE, decimals: 6.5 },
        { ...X402_READY_SOURCE, decimals: -1 },
        { ...X402_READY_SOURCE, decimals: 256 },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([]);
  });

  it("serves the cached decimals at the edges of the valid range", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        { ...X402_READY_SOURCE, decimals: 0 },
        {
          ...X402_READY_SOURCE,
          evmWalletId: "wallet_2",
          decimals: 255,
        },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([
      { ...X402_READY_SOURCE, decimals: 0 },
      { ...X402_READY_SOURCE, evmWalletId: "wallet_2", decimals: 255 },
    ]);
  });

  it("canonicalizes a mixed-case cached asset and drops cached extras", async () => {
    // EVM_ADDRESS_PATTERN accepts mixed case, so a legacy or hand-edited row
    // was VALIDATED in one spelling and RETURNED in another — the same
    // validate-one / return-another split the 402 normalizer closed.
    // Everything downstream (`findX402ReadySource`, `buildCaip19AssetKey`,
    // and the pay call's `preferredAsset`) compares canonical lowercase, so
    // the read must emit it. Cached extras go for the same reason: only the
    // fields `X402ReadySource` declares are served.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        {
          caip2Network: "eip155:84532",
          asset: USDC_BASE_SEPOLIA.toUpperCase().replace("0X", "0x"),
          evmWalletId: "wallet_1",
          decimals: 6,
          remainingSpend: "999",
        },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
  });

  it("still drops a row whose network is not canonical lowercase", async () => {
    // CAIP2_EVM_NETWORK_PATTERN is case-SENSITIVE, unlike the address
    // pattern, so a shouty network already failed closed. Canonicalizing the
    // survivors must not turn that into an accepted row.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        { ...X402_READY_SOURCE, caip2Network: "EIP155:84532" },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([]);
  });

  it("drops cached pairs outside this environment's allowlist", async () => {
    // Defence in depth behind the compose-time filter: a cache written by an
    // older build (or by an instance pointed at the other environment) must
    // not serve a Base MAINNET pair to a Preprod deployment.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        {
          caip2Network: "eip155:8453",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          evmWalletId: "wallet_mainnet",
          decimals: 6,
        },
        X402_READY_SOURCE,
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([X402_READY_SOURCE]);
  });

  it("serves the mainnet pair and drops the testnet one on Mainnet", async () => {
    getEnvMock.mockReturnValueOnce({
      DATABASE_URL: "https://example.com/database",
      NETWORK: "Mainnet",
    });
    const mainnetSource = {
      caip2Network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      evmWalletId: "wallet_mainnet",
      decimals: 6,
    };
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([mainnetSource, X402_READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    await expect(getX402ReadySources(tx)).resolves.toEqual([mainnetSource]);
  });
});

describe("findX402ReadySource", () => {
  it("returns the recorded pair with its backing wallet id and decimals", () => {
    expect(
      findX402ReadySource("EIP155:84532", USDC_BASE_SEPOLIA.toUpperCase(), [
        X402_READY_SOURCE,
      ]),
    ).toEqual(X402_READY_SOURCE);
  });

  it("requires the exact network and asset pair", () => {
    // Callers take the charged `decimals` and the signing `evmWalletId` off
    // the returned pair, so a near-miss must be undefined rather than the
    // wrong chain's or the wrong token's numbers.
    expect(
      findX402ReadySource("eip155:8453", USDC_BASE_SEPOLIA, [
        X402_READY_SOURCE,
      ]),
    ).toBeUndefined();
    expect(
      findX402ReadySource(
        "eip155:84532",
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        [X402_READY_SOURCE],
      ),
    ).toBeUndefined();
    expect(
      findX402ReadySource("eip155:84532", USDC_BASE_SEPOLIA, []),
    ).toBeUndefined();
  });
});

describe("per-environment network allowlist", () => {
  it("allows only testnet networks on Preprod", () => {
    expect(getAllowedX402Caip2Networks("Preprod")).toEqual(["eip155:84532"]);
    expect(isX402NetworkAllowed("eip155:84532", "Preprod")).toBe(true);
    expect(isX402NetworkAllowed("eip155:8453", "Preprod")).toBe(false);
  });

  it("allows only mainnet networks on Mainnet", () => {
    expect(getAllowedX402Caip2Networks("Mainnet")).toEqual(["eip155:8453"]);
    expect(isX402NetworkAllowed("eip155:8453", "Mainnet")).toBe(true);
    expect(isX402NetworkAllowed("eip155:84532", "Mainnet")).toBe(false);
  });

  it("rejects unknown networks in every environment (never a guess)", () => {
    for (const network of [
      "eip155:1",
      "eip155:10",
      "solana:mainnet",
      "base",
      "base-sepolia",
      "",
    ]) {
      expect(isX402NetworkAllowed(network, "Preprod")).toBe(false);
      expect(isX402NetworkAllowed(network, "Mainnet")).toBe(false);
    }
  });

  it("normalizes casing and whitespace before matching", () => {
    expect(isX402NetworkAllowed(" EIP155:84532 ", "Preprod")).toBe(true);
  });
});
