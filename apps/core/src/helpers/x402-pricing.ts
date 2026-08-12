import type { CreditCost } from "@sokosumi/database";
import {
  buildCaip19AssetKey,
  normalizeMasumiPaymentUnit,
} from "@sokosumi/masumi";
import { convertCreditsToCents } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";

import { unprocessableEntity } from "./error";

/**
 * Widest asset scale this module will price — an ERC-20 `decimals` is a
 * `uint8`, so 255 is the type's own ceiling.
 */
export const X402_MAX_ASSET_DECIMALS = 255;

/**
 * Whether a value is a usable ERC-20 `decimals`: an integer in `0..255`.
 *
 * Owned here because `decimals` matters only to the formula below, and it
 * scales the charge INVERSELY: a scale that is off by n prices the call 10^n
 * wrong, in the direction that favours whoever supplied it. Every crossing
 * into this module — the readiness cache on the way in, the demand on the way
 * through — asks this one question, so an unusable value drops the pair or
 * rejects the charge rather than being defaulted, rounded, or clamped.
 */
export function isUsableAssetDecimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= X402_MAX_ASSET_DECIMALS
  );
}

/**
 * Converts an x402 base-unit amount into billable cents via its CAIP-19
 * `CreditCost` row (wayfinder ticket 004; PR1-SPEC §3.4).
 *
 * Pricing convention for CAIP-19 rows: `centsPerUnit` is cents per ONE WHOLE
 * token (i.e. per 10^decimals base units), unlike Cardano rows where it is
 * cents per smallest unit. The whole-token scale is what "explicit decimals
 * handling" in ticket 004 decides: cents carry 10 decimal places
 * (`CREDITS_BASE`), so per-base-unit pricing could not represent any asset
 * with more than 10 decimals — an 18-decimals token would round to zero cents
 * per base unit and silently price every call at the floor.
 *
 * Rounding is CEILING, then floored at `MIN_CHARGEABLE_CREDITS`: dust never
 * rounds to a zero charge (Soko margin, never loss) and every payment charges
 * at least the platform minimum.
 *
 * Fail closed: an asset without a `CreditCost` row rejects pre-charge with a
 * 422, mirroring the Cardano availability rule.
 */
export interface X402AmountPricingInput {
  /** CAIP-2 EVM network from the matched 402 entry, e.g. `eip155:8453`. */
  caip2Network: string;
  /** ERC-20 contract address of the demanded asset. */
  asset: string;
  /** Demanded amount in token base units (`^\d+$`, chain-native). */
  amount: string;
  /** Asset decimals from the agent's registered payment source (USDC = 6). */
  decimals: number;
}

export function calculateCentsFromX402Amount(
  input: X402AmountPricingInput,
  creditCosts: CreditCost[],
): bigint {
  if (!/^\d+$/.test(input.amount)) {
    throw unprocessableEntity(`Invalid x402 amount: ${input.amount}`);
  }
  const amount = BigInt(input.amount);
  if (amount <= 0n) {
    throw unprocessableEntity("x402 amount must be positive");
  }
  if (!isUsableAssetDecimals(input.decimals)) {
    throw unprocessableEntity(`Invalid asset decimals: ${input.decimals}`);
  }

  let unit: string;
  try {
    unit = buildCaip19AssetKey(input.caip2Network, input.asset);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid x402 asset identity",
    );
  }

  // CreditCost.unit is free-form operator input; normalize both sides like
  // calculateCentsFromPricingAmountRows so casing can never unlist an asset.
  const creditCost = creditCosts.find(
    (candidate) => normalizeMasumiPaymentUnit(candidate.unit) === unit,
  );
  if (!creditCost) {
    // Fail closed (ticket 004): no priced asset, no charge, no signing.
    throw unprocessableEntity(`Credit cost not found for unit ${unit}`);
  }
  if (creditCost.centsPerUnit <= 0n) {
    // A zero- or negative-priced row would turn every demand into a floor
    // charge with no operator intent behind it — treat it as unpriced.
    throw unprocessableEntity(`Credit cost for unit ${unit} is not positive`);
  }

  const baseUnitsPerToken = 10n ** BigInt(input.decimals);
  // Ceiling division: partial base units always round the charge UP.
  const cents =
    (amount * creditCost.centsPerUnit + baseUnitsPerToken - 1n) /
    baseUnitsPerToken;

  const minChargeableCents = convertCreditsToCents(
    LIMITS.MIN_CHARGEABLE_CREDITS,
  );
  return cents > minChargeableCents ? cents : minChargeableCents;
}
