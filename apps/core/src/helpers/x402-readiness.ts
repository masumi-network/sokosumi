import { AgentEntryType, AgentStatus, type Prisma } from "@sokosumi/database";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "@sokosumi/masumi";
import { isValidHttpUrl } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { isUsableAssetDecimals } from "@/helpers/x402-pricing";
import prisma from "@/lib/db/prisma";

/**
 * x402 buy-side readiness (PR1-SPEC §6, ticket 011 Q5).
 *
 * Composed Soko-side from the node's `GET /x402/networks/available`,
 * `GET /x402/wallets`, and the calling key's spend caps on
 * `GET /api-key-status`, by
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
 * is enabled for x402, the node publishes a usable scale for the asset, and a
 * funded Purchasing wallet has native gas plus the matching token. Network,
 * asset, and wallet address are canonical lowercase; `evmWalletId` is the
 * node's opaque wallet id, case-sensitive and trimmed of surrounding
 * whitespace (blank ids cannot be signed with).
 */
export interface X402ReadySource {
  /** CAIP-2 EVM network id, e.g. `eip155:84532`. */
  caip2Network: string;
  /** ERC-20 contract address the pair is priced and paid in. */
  asset: string;
  /**
   * Managed EVM wallet that signs this pair — the `evmWalletId` the pay
   * route passes to `POST /x402/pay`, so signing needs no per-payment
   * wallet lookup. The spend cap is key-global (masumi ADR 0016), so any
   * funded wallet on the chain is an equally valid signer; the sync recorded
   * the one holding the most of the priced token.
   */
  evmWalletId: string;
  /** Expected EVM payer address for this managed wallet, canonical lowercase. */
  evmWalletAddress: string;
  /**
   * Base units per whole token for `asset`, as the NODE publishes it
   * (`defaultAssetDecimals` on `GET /x402/networks/available`) — never as the
   * agent registered it.
   *
   * This is the one authoritative copy Soko has. The registry's `decimals`
   * sits on the agent's own entry: an agent that registers USDC with
   * `decimals: 18` (true value 6) divides its own charge by 10^12 while
   * Soko's managed wallet signs away the real amount, and the demand still
   * passes the ceiling check because that compares against the same
   * agent-registered amount. Both the compose and the read fail closed when
   * the node reports nothing usable — see {@link isUsableAssetDecimals}.
   */
  decimals: number;
}

export interface X402TrustedExactEvmDomain {
  name: string;
  version: string;
}

/**
 * Trusted EIP-712 domains for every exact-EVM asset this deployment supports.
 * Resource-server `extra` is attacker-authored and must never define the
 * domain Soko uses to bless a managed-wallet signature.
 */
const X402_TRUSTED_EXACT_EVM_DOMAINS: Readonly<
  Record<string, X402TrustedExactEvmDomain>
> = {
  "eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": {
    name: "USDC",
    version: "2",
  },
  "eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
    name: "USD Coin",
    version: "2",
  },
};

export function getTrustedX402ExactEvmDomain(
  caip2Network: string,
  asset: string,
): X402TrustedExactEvmDomain | null {
  return (
    X402_TRUSTED_EXACT_EVM_DOMAINS[
      `${caip2Network.trim().toLowerCase()}:${asset.trim().toLowerCase()}`
    ] ?? null
  );
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

/** Production curates x402 catalog entries; Preprod exposes all online ones. */
export function requiresX402AgentCuration(
  network: "Preprod" | "Mainnet",
): boolean {
  return network === "Mainnet";
}

/**
 * Database-visible catalog gates shared by listing and pay lookup. URL syntax
 * cannot be expressed safely through Prisma's string filters, so callers must
 * also apply {@link hasValidX402DiscoveryUrl} to every returned row.
 */
export function getX402AgentCatalogWhere(
  network: "Preprod" | "Mainnet",
): Prisma.AgentWhereInput {
  return {
    OR: [
      {
        type: AgentEntryType.X402,
        x402ResourcesUrl: { not: null },
      },
      {
        type: AgentEntryType.OPEN_API,
        openApiSpecUrl: { not: null },
        paymentSources: { some: { scheme: { not: null } } },
      },
    ],
    status: AgentStatus.ONLINE,
    ...(requiresX402AgentCuration(network) ? { isShown: true } : {}),
  };
}

/** Fail-closed validation for registry-controlled discovery endpoints. */
export function hasValidX402DiscoveryUrl(agent: {
  type: string;
  x402ResourcesUrl: string | null;
  openApiSpecUrl: string | null;
}): boolean {
  if (agent.type === AgentEntryType.X402) {
    return (
      agent.x402ResourcesUrl !== null && isValidHttpUrl(agent.x402ResourcesUrl)
    );
  }
  if (agent.type === AgentEntryType.OPEN_API) {
    return (
      agent.openApiSpecUrl !== null && isValidHttpUrl(agent.openApiSpecUrl)
    );
  }
  return false;
}

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
 * Node wallet ids are opaque and case-sensitive. Strip surrounding
 * whitespace only — a blank id cannot be signed with.
 */
export function trimEvmWalletId(id: string): string | undefined {
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

/**
 * Exact (network, asset) pairs the payment node last reported buy-side ready.
 * Empty means never recorded, the payload is unusable, OR a successful check
 * found nothing ready — those three are indistinguishable to callers.
 * Listing and pay treat empty as fail-closed.
 *
 * Deliberately NOT expired on age, mirroring `getCardanoV2ReadySources`:
 * readiness is configuration plus funded-wallet presence, refreshed by the sync
 * cron; a value that has not been refreshed for a while is almost certainly
 * still true, and expiring it would let our own cron falling behind take the
 * entire x402 listing down. A node that truly cannot pay refuses the sign,
 * and the sign-failure path refunds synchronously (provably unpaid).
 *
 * Read straight from the row on every call — a primary-key lookup; a
 * process-local memo would only add staleness while letting instances
 * disagree with each other.
 *
 * The per-environment allowlist is applied again here, behind the
 * compose-time filter in `composeX402ReadySources`: a row written by an older
 * build — or by an instance pointed at the other environment — must not serve
 * a mainnet pair to a Preprod deployment. Re-filtering on read costs an array
 * pass and removes the cache as a trusted input.
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

  const environment = getEnv().NETWORK;
  try {
    const payload: unknown = JSON.parse(readiness.cursorId);
    if (!Array.isArray(payload)) {
      return [];
    }
    const canonicalSources = payload
      .filter(
        (source): source is X402ReadySource =>
          typeof source === "object" &&
          source !== null &&
          "caip2Network" in source &&
          typeof source.caip2Network === "string" &&
          CAIP2_EVM_NETWORK_PATTERN.test(source.caip2Network) &&
          isX402NetworkAllowed(source.caip2Network, environment) &&
          "asset" in source &&
          typeof source.asset === "string" &&
          EVM_ADDRESS_PATTERN.test(source.asset) &&
          // Old builds could cache any node-default ERC-20. Pay now accepts
          // only pairs with locally trusted EIP-712 domain metadata, so the
          // read path must apply the same filter or listing would advertise
          // an agent whose payment route always fails closed.
          getTrustedX402ExactEvmDomain(source.caip2Network, source.asset) !==
            null &&
          // A pair without its backing wallet cannot be signed with — a row
          // cached before the evmWalletId field existed is unusable and drops
          // until the next sync rewrites the cache.
          "evmWalletId" in source &&
          typeof source.evmWalletId === "string" &&
          trimEvmWalletId(source.evmWalletId) !== undefined &&
          // The signed payer must later match the exact wallet whose
          // balances made this pair ready. Old cache rows without the
          // expected address cannot establish that binding and fail closed.
          "evmWalletAddress" in source &&
          typeof source.evmWalletAddress === "string" &&
          EVM_ADDRESS_PATTERN.test(source.evmWalletAddress) &&
          // Same treatment for the node-published decimals, and for the same
          // reason the other fields are re-validated here: the cache is not a
          // trusted input. A row written before this field existed — or one
          // carrying a non-integer or out-of-range value — has no usable
          // scale, and pricing off a wrong scale is a 10^n mischarge. Drop
          // the pair until the next sync rewrites the cache; NEVER fall back
          // to the agent-registered decimals.
          "decimals" in source &&
          isUsableAssetDecimals(source.decimals),
      )
      // Emit the canonical pair rather than the row as stored.
      // EVM_ADDRESS_PATTERN accepts mixed case, so a legacy or hand-edited
      // row would be VALIDATED in one spelling and RETURNED in another —
      // the same validate-one / forward-another split the 402 normalizer
      // closed. Everything downstream compares canonical lowercase
      // (`findX402ReadySource`, `buildCaip19AssetKey`, and the pay call's
      // `preferredAsset`, where a mismatch would miss the node lookup AFTER
      // the credits are charged). `composeX402ReadySources` writes lowercase
      // today, so this only bites a legacy row — which is exactly why the
      // read must not trust the cache. Extra cached properties are dropped
      // for the same reason: only the fields `X402ReadySource` declares are
      // served.
      .map((source) => ({
        caip2Network: source.caip2Network.trim().toLowerCase(),
        asset: source.asset.trim().toLowerCase(),
        evmWalletId: source.evmWalletId.trim(),
        evmWalletAddress: source.evmWalletAddress.trim().toLowerCase(),
        decimals: source.decimals,
      }));
    // `composeX402ReadySources` keys its output on the canonical
    // (network, asset), so a healthy cache can never repeat a pair — but the
    // cache is not a trusted input (see above), and `findX402ReadySource`
    // returns the FIRST match, so a hand-edited or legacy row that duplicates
    // a pair would let array order pick the signer wallet and the charge
    // scale. Mirror the compose-side rule: an exact repeat collapses to one
    // row; a disagreeing repeat poisons the pair (neither spelling is served).
    const sourcesByPair = new Map<string, X402ReadySource | null>();
    for (const source of canonicalSources) {
      const key = `${source.caip2Network}:${source.asset}`;
      const recorded = sourcesByPair.get(key);
      if (recorded === undefined) {
        sourcesByPair.set(key, source);
        continue;
      }
      if (
        recorded === null ||
        recorded.evmWalletId !== source.evmWalletId ||
        recorded.evmWalletAddress !== source.evmWalletAddress ||
        recorded.decimals !== source.decimals
      ) {
        sourcesByPair.set(key, null);
      }
    }
    return [...sourcesByPair.values()].filter(
      (source): source is X402ReadySource => source !== null,
    );
  } catch {
    return [];
  }
};
