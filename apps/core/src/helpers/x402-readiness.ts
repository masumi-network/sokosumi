import type { Prisma } from "@sokosumi/database";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "@sokosumi/masumi";

import prisma from "@/lib/db/prisma";

/**
 * x402 buy-side readiness (PR1-SPEC §6, ticket 011 Q5).
 *
 * Composed Soko-side from the node's `GET /x402/networks/available` and
 * `GET /x402/budgets` (both per-chain today) by
 * `syncX402BuySideReadiness`, cached in SyncMetadata under
 * `X402_BUY_SIDE_READINESS_KEY` exactly like the Cardano V2 rail readiness:
 * last-known-value semantics, failure marker for one page per streak, and a
 * never-recorded state that hides the entire x402 listing (fail closed).
 */
export const X402_BUY_SIDE_READINESS_KEY = "x402-buy-side-readiness";
export const X402_BUY_SIDE_READINESS_FAILURE_KEY =
  "x402-buy-side-readiness-failure";

/**
 * One (network, asset) pair the payment node can pay on right now: the chain
 * is enabled for x402 and a budget in that asset has remaining spend.
 * Network and asset are canonical lowercase; `evmWalletId` is the node's
 * opaque wallet id, carried verbatim.
 */
export interface X402ReadySource {
  /** CAIP-2 EVM network id, e.g. `eip155:84532`. */
  caip2Network: string;
  /** ERC-20 contract address the funded budget is denominated in. */
  asset: string;
  /**
   * Managed EVM wallet backing the pair's budget — the `evmWalletId` the pay
   * route passes to `POST /x402/pay`, so signing needs no per-payment
   * `/x402/budgets` fetch. When several budgets back the pair, the sync
   * recorded the one with the most remaining spend.
   */
  evmWalletId: string;
}

/**
 * Per-environment EVM network allowlist (PR1-SPEC §2/§6). Preprod may only
 * pay on testnet chains, production only on mainnet chains — the environment
 * comes from the same `NETWORK` env that splits Cardano Preprod/Mainnet.
 * ONLY the networks research 001 documents are listed; an unknown network is
 * simply not allowed, never guessed at.
 */
const X402_TESTNET_ALLOWED_CAIP2_NETWORKS: readonly string[] = [
  // Base Sepolia
  "eip155:84532",
];
const X402_MAINNET_ALLOWED_CAIP2_NETWORKS: readonly string[] = [
  // Base mainnet
  "eip155:8453",
];

export function getAllowedX402Caip2Networks(
  network: "Preprod" | "Mainnet",
): readonly string[] {
  return network === "Mainnet"
    ? X402_MAINNET_ALLOWED_CAIP2_NETWORKS
    : X402_TESTNET_ALLOWED_CAIP2_NETWORKS;
}

/** Whether a CAIP-2 network may be paid on in this environment. */
export function isX402NetworkAllowed(
  caip2Network: string,
  network: "Preprod" | "Mainnet",
): boolean {
  return getAllowedX402Caip2Networks(network).includes(
    caip2Network.trim().toLowerCase(),
  );
}

/**
 * The recorded ready pair for an advertised (network, asset), or undefined
 * when the pair is not buy-side ready. Lowercases both sides so a mixed-case
 * address from the registry still matches the canonical cached pair. The
 * returned pair carries the `evmWalletId` the pay route signs with.
 */
export function findX402ReadySource(
  caip2Network: string,
  asset: string,
  readySources: readonly X402ReadySource[],
): X402ReadySource | undefined {
  const normalizedNetwork = caip2Network.trim().toLowerCase();
  const normalizedAsset = asset.trim().toLowerCase();
  return readySources.find(
    (source) =>
      source.caip2Network.trim().toLowerCase() === normalizedNetwork &&
      source.asset.trim().toLowerCase() === normalizedAsset,
  );
}

/** Whether an advertised (network, asset) pair is buy-side ready. */
export function isX402SourceReady(
  caip2Network: string,
  asset: string,
  readySources: readonly X402ReadySource[],
): boolean {
  return findX402ReadySource(caip2Network, asset, readySources) !== undefined;
}

/**
 * Exact (network, asset) pairs the payment node last reported buy-side ready.
 * Returns an empty list only when readiness has never been recorded, or the
 * recorded payload is unusable.
 *
 * Deliberately NOT expired on age, mirroring `getCardanoV2ReadySources`:
 * readiness is configuration plus budget presence, refreshed by the sync
 * cron; a value that has not been refreshed for a while is almost certainly
 * still true, and expiring it would let our own cron falling behind take the
 * entire x402 listing down. A node that truly cannot pay refuses the sign,
 * and the sign-failure path refunds synchronously (provably unpaid).
 *
 * Read straight from the row on every call — a primary-key lookup; a
 * process-local memo would only add staleness while letting instances
 * disagree with each other.
 */
export const getX402ReadySources = async (
  tx: Prisma.TransactionClient = prisma,
): Promise<X402ReadySource[]> => {
  const readiness = await tx.syncMetadata.findUnique({
    where: { key: X402_BUY_SIDE_READINESS_KEY },
  });
  if (!readiness?.cursorId) {
    return [];
  }

  try {
    const payload: unknown = JSON.parse(readiness.cursorId);
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.filter(
      (source): source is X402ReadySource =>
        typeof source === "object" &&
        source !== null &&
        "caip2Network" in source &&
        typeof source.caip2Network === "string" &&
        CAIP2_EVM_NETWORK_PATTERN.test(source.caip2Network) &&
        "asset" in source &&
        typeof source.asset === "string" &&
        EVM_ADDRESS_PATTERN.test(source.asset) &&
        // A pair without its backing wallet cannot be signed with — a row
        // cached before the evmWalletId field existed is unusable and drops
        // until the next sync rewrites the cache.
        "evmWalletId" in source &&
        typeof source.evmWalletId === "string" &&
        source.evmWalletId.length > 0,
    );
  } catch {
    return [];
  }
};
