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

/**
 * CAIP-2 EVM network id, e.g. `eip155:8453`.
 *
 * The chain-id reference is anchored to CAIP-2's canonical integer form —
 * no leading zeros, at most 32 characters — because this pattern is what
 * DECIDES canonical spelling: `normalizeX402NetworkId` passes any match
 * through verbatim, so a pattern that accepted `eip155:08453` would mint a
 * second spelling for chain 8453 and break the no-second-spelling guarantee
 * the module doc promises.
 */
export const CAIP2_EVM_NETWORK_PATTERN = /^eip155:(0|[1-9]\d{0,31})$/;

/** ERC-20 contract address: 0x + 40 hex chars. */
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

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
 * Whether a `CreditCost.unit` spelling belongs to the EVM (`eip155:`)
 * namespace AT ALL — canonical or not.
 *
 * This is the EXCLUSION fence, deliberately broader than the canonical
 * CAIP-19 key `buildCaip19AssetKey` mints. The builder answers "may this key
 * enter the whole-token pricing path" — a positive gate, where strictness
 * fails closed. This answers the opposite question: "must this unit be kept
 * OUT of the per-smallest-unit Cardano path". There, strictness fails OPEN:
 * a misspelled key such as `eip155:08453/erc20:0x…` fails the canonical
 * pattern, but if the Cardano path honored it the row would be priced per
 * smallest unit against a whole-token `centsPerUnit` — a 10^decimals
 * mischarge. So the fence catches the whole namespace, not only well-formed
 * keys. No Cardano unit can ever start with `eip155:` (they are `lovelace`,
 * the empty string, or hex policy/asset ids, which cannot contain `:`).
 */
export function isEvmNamespacedUnit(unit: string): boolean {
  return unit.trim().toLowerCase().startsWith("eip155:");
}
