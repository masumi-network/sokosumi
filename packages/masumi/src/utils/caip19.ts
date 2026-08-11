/**
 * CAIP-19 asset keys for EVM x402 assets.
 *
 * `CreditCost.unit` rows for EVM assets store the CAIP-19 form decided in
 * ADR 0001 / wayfinder ticket 004: `eip155:<chainId>/erc20:<address>`,
 * canonically lowercase. Lowercase matters because `CreditCost.unit` is
 * compared through `normalizeMasumiPaymentUnit` (which lowercases), so a key
 * built here is byte-identical after normalization — no second spelling can
 * ever exist for the same asset.
 */

/** CAIP-2 EVM network id, e.g. `eip155:8453`. */
export const CAIP2_EVM_NETWORK_PATTERN = /^eip155:\d+$/;

/** ERC-20 contract address: 0x + 40 hex chars. */
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

const CAIP19_ERC20_KEY_PATTERN = /^eip155:\d+\/erc20:0x[0-9a-f]{40}$/;

export interface Caip19AssetKeyParts {
  /** Lowercase CAIP-2 network id, e.g. `eip155:8453`. */
  caip2Network: string;
  /** Lowercase ERC-20 contract address, e.g. `0xabc…` (42 chars). */
  assetAddress: string;
}

/**
 * Builds the canonical lowercase CAIP-19 `CreditCost.unit` key for an ERC-20
 * asset on an EVM chain: `eip155:8453/erc20:0x…`.
 *
 * Throws on malformed input — a garbage network or address must never mint a
 * plausible-looking key that silently prices nothing (fail loud, ticket 004).
 */
export function buildCaip19AssetKey(
  caip2Network: string,
  assetAddress: string,
): string {
  const normalizedNetwork = caip2Network.trim().toLowerCase();
  if (!CAIP2_EVM_NETWORK_PATTERN.test(normalizedNetwork)) {
    throw new Error(
      `Invalid CAIP-2 EVM network for CAIP-19 asset key: ${caip2Network}`,
    );
  }
  const normalizedAddress = assetAddress.trim().toLowerCase();
  if (!EVM_ADDRESS_PATTERN.test(normalizedAddress)) {
    throw new Error(
      `Invalid ERC-20 asset address for CAIP-19 asset key: ${assetAddress}`,
    );
  }
  return `${normalizedNetwork}/erc20:${normalizedAddress}`;
}

/**
 * Parses a CAIP-19 ERC-20 asset key back into its parts. Case-insensitive on
 * input (rows predating canonicalization may carry uppercase hex); the parts
 * come back lowercase. Returns `null` for anything that is not a well-formed
 * `eip155:<chainId>/erc20:<address>` key — including Cardano units, which
 * simply are not CAIP-19 keys.
 */
export function parseCaip19AssetKey(key: string): Caip19AssetKeyParts | null {
  const normalized = key.trim().toLowerCase();
  if (!CAIP19_ERC20_KEY_PATTERN.test(normalized)) {
    return null;
  }
  const [caip2Network, assetPart] = normalized.split("/") as [string, string];
  return {
    caip2Network,
    assetAddress: assetPart.slice("erc20:".length),
  };
}

/** Whether a `CreditCost.unit` value is a CAIP-19 ERC-20 asset key. */
export function isCaip19AssetKey(key: string): boolean {
  return parseCaip19AssetKey(key) !== null;
}
