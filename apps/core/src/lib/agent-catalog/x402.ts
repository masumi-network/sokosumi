import { AgentEntryType, AgentStatus, type Prisma } from "@sokosumi/database";

import { isValidHttpUrl } from "@sokosumi/utils";

import type { Network } from "@/lib/network";

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
   * Managed EVM wallet that signs this pair: the `evmWalletId` the pay
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

/** The Network an x402 chain belongs to: Base is Mainnet, Base Sepolia is Preprod. */
export function x402ChainNetwork(caip2Network: string): Network | undefined {
  const chain = caip2Network.trim().toLowerCase();
  if (X402_MAINNET_ALLOWED_CAIP2_NETWORKS.includes(chain)) return "mainnet";
  if (X402_TESTNET_ALLOWED_CAIP2_NETWORKS.includes(chain)) return "preprod";
  return undefined;
}

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
