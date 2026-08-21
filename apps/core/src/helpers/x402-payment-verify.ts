import type { AgentPaymentSourceAmount } from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import {
  X402_MIN_TIMEOUT_SECONDS,
  type X402PaymentRequirements,
} from "@sokosumi/masumi/schemas";

import { unprocessableEntity } from "./error.js";
import type { X402AgentPaymentSourceRow } from "./x402-agent-listing.js";
import {
  getTrustedX402ExactEvmDomain,
  isX402NetworkAllowed,
} from "./x402-readiness.js";

/**
 * Verify-against-the-listed-agent (PR1-SPEC §3.3): the demanded
 * (payTo, network, asset) must match one of the agent's registered payment
 * sources, the network must be in the per-environment allowlist, the demanded
 * amount must pass a sanity check against the registered pricing, and the
 * payment window must be long enough for the authorization to be usable.
 * Every failure throws a 422 BEFORE any credits are charged.
 *
 * This is the pay-side twin of the listing gate in
 * `buildX402AgentPaymentSources` — the listing promises "listed ⇒ payable",
 * and this matcher is what holds a forwarded 402 to that promise.
 */

// The row shape is the LISTING's — one type on purpose: this matcher is the
// pay-side twin of the listing gate, and two independently-maintained views
// of the same rows is how the twins drift apart (a column added to one
// side's select but not the other keeps compiling on the old shape).

/** The single 402 entry the node will be restricted to signing. */
export interface X402VerifiedDemand {
  /** Whether the registry supplied a ceiling or the 402 supplied the price. */
  pricingType: "FIXED" | "DYNAMIC";
  /** Canonical lowercase CAIP-2 network id. */
  caip2Network: string;
  /** Canonical lowercase ERC-20 address. */
  asset: string;
  /** Demanded amount in token base units. */
  amount: string;
  /**
   * Canonical lowercase recipient address.
   *
   * Lowercased like `caip2Network` and `asset`, NOT echoed in the 402's own
   * spelling. What gets signed is `entry`, forwarded verbatim; this scalar
   * exists to be stored on the payment row and compared against the node's
   * signed result. Returning it in a third spelling was asymmetric with its
   * two siblings and only ever safe because every downstream comparison is
   * `.toLowerCase()`-guarded — i.e. it depended on two other layers
   * compensating for it.
   */
  payTo: string;
  /** Trusted token-contract EIP-712 domain, never resource-authored. */
  domainName: string;
  domainVersion: string;
  /**
   * The matched `accepts` entry itself, by identity — so the caller can
   * forward ONLY this entry (`narrowToChosenRequirement`) instead of the whole
   * payload. The node chooses which forwarded entry it signs and nothing
   * node-side constrains `payTo`, so which entry it sees is a Soko-side
   * decision, and it can only be made here: re-deriving it downstream from
   * the scalars would reintroduce the ambiguity this removes.
   */
  entry: X402PaymentRequirements;
}

interface MatchedEntry {
  entry: X402PaymentRequirements;
  pricingType: "FIXED" | "DYNAMIC";
  amountRow?: Pick<AgentPaymentSourceAmount, "unit" | "amount" | "decimals">;
}

function sourceIdentityMatches(
  source: X402AgentPaymentSourceRow,
  entry: X402PaymentRequirements,
): boolean {
  const network = entry.network.toLowerCase();
  const payTo = entry.payTo.toLowerCase();
  // The demand's OWN scheme, not the allowlist: `entry.scheme` is already
  // allowlist-validated by the 402 schema, so comparing against the source
  // row keeps registration and demand bound pairwise — an allowlist
  // membership test would let a demand for one scheme match a source
  // registered for another the moment `X402_SUPPORTED_SCHEMES` grows, and
  // the node would sign under settlement semantics the registry never
  // advertised for that recipient. The registry mirrors scheme text
  // verbatim (`"Exact"`), hence the trim/case-fold.
  return (
    source.scheme?.trim().toLowerCase() === entry.scheme &&
    Boolean(source.payTo) &&
    source.payTo?.trim().toLowerCase() === payTo &&
    source.network.trim().toLowerCase() === network
  );
}

function findRegisteredMatch(
  entry: X402PaymentRequirements,
  paymentSources: readonly X402AgentPaymentSourceRow[],
): MatchedEntry | undefined {
  const asset = entry.asset.toLowerCase();

  // Prefer a fixed match when an agent has overlapping fixed and dynamic
  // registrations. The fixed row carries a registry-authored ceiling; taking
  // a broader dynamic match first would silently discard that stronger bound.
  for (const source of paymentSources) {
    if (
      source.pricingType !== PricingType.FIXED ||
      !sourceIdentityMatches(source, entry)
    ) {
      continue;
    }
    const amountRow = source.amounts.find(
      (candidate) => candidate.unit.trim().toLowerCase() === asset,
    );
    if (amountRow) {
      return { entry, pricingType: PricingType.FIXED, amountRow };
    }
  }

  // Dynamic sources intentionally register no amount or asset. Their runtime
  // 402 is the quote. Registry identity still pins recipient, network and
  // signing scheme; readiness pins the demanded asset later, and maxCredits
  // supplies the mandatory caller-controlled spend ceiling before debit.
  for (const source of paymentSources) {
    if (
      source.pricingType === PricingType.DYNAMIC &&
      sourceIdentityMatches(source, entry)
    ) {
      return { entry, pricingType: PricingType.DYNAMIC };
    }
  }
  return undefined;
}

/**
 * Matches the forwarded 402's `accepts` against the agent's registered
 * payment sources and returns the ONE demand the node may sign, or throws a
 * 422.
 *
 * The pay call forwards the whole 402 and restricts the node with
 * `preferredNetwork`/`preferredAsset` — the node may then sign ANY entry on
 * that (network, asset) pair. So verification is only sound if every entry
 * sharing the chosen pair is identical in what gets signed (payTo, amount);
 * a 402 whose same-pair entries disagree is refused rather than guessed at.
 */
export function verifyX402DemandAgainstAgentSources(
  accepts: readonly X402PaymentRequirements[],
  paymentSources: readonly X402AgentPaymentSourceRow[],
  environment: "Preprod" | "Mainnet",
): X402VerifiedDemand {
  const match = accepts
    .map((entry) => findRegisteredMatch(entry, paymentSources))
    .find((candidate) => candidate !== undefined);
  if (!match) {
    throw unprocessableEntity(
      "The 402 does not match any of the listed agent's registered payment sources (payTo, network, asset)",
    );
  }

  const { entry, pricingType, amountRow } = match;
  const caip2Network = entry.network.toLowerCase();
  const asset = entry.asset.toLowerCase();
  const payTo = entry.payTo.toLowerCase();

  if (!isX402NetworkAllowed(caip2Network, environment)) {
    throw unprocessableEntity(
      `x402 network ${caip2Network} is not allowed in this environment`,
    );
  }

  const trustedDomain = getTrustedX402ExactEvmDomain(caip2Network, asset);
  if (
    trustedDomain === null ||
    entry.extra?.name !== trustedDomain.name ||
    entry.extra?.version !== trustedDomain.version
  ) {
    throw unprocessableEntity(
      `The 402 does not declare the trusted EIP-712 domain for ${caip2Network}/${asset}. Nothing was charged.`,
    );
  }

  // The node could sign any same-pair entry, so all of them must demand the
  // exact same signed terms. Disagreement is a malformed (or manipulated)
  // 402 — never pick one (same stance as the normalizer's conflict guards).
  const samePairEntries = accepts.filter(
    (candidate) =>
      candidate.network.toLowerCase() === caip2Network &&
      candidate.asset.toLowerCase() === asset,
  );
  for (const candidate of samePairEntries) {
    if (
      candidate.payTo.toLowerCase() !== entry.payTo.toLowerCase() ||
      candidate.amount !== entry.amount
    ) {
      throw unprocessableEntity(
        `Conflicting 402 entries for ${caip2Network}/${asset}: the node could sign an unverified variant`,
      );
    }
  }

  // The payment window, checked BEFORE the debit like every other 422 here.
  //
  // Only the matched entry is checked, and that is sufficient: the caller
  // forwards this entry ALONE (`narrowToChosenRequirement`), so it is the only
  // `maxTimeoutSeconds` the node can sign against. The same-pair agreement
  // check above compares payTo and amount, not the window, so a sibling with a
  // different window is irrelevant once the payload is narrowed.
  //
  // Nothing downstream can undo a window this short — see
  // X402_MIN_TIMEOUT_SECONDS for the post-charge wedge it prevents — so a
  // pre-charge 422 is the only place the coworker keeps its credits.
  if (entry.maxTimeoutSeconds < X402_MIN_TIMEOUT_SECONDS) {
    throw unprocessableEntity(
      `The 402's payment window of ${entry.maxTimeoutSeconds}s for ${caip2Network}/${asset} is below the ${X402_MIN_TIMEOUT_SECONDS}s minimum; ` +
        "the signed authorization would expire before it could be used. Nothing was charged.",
    );
  }

  if (pricingType === PricingType.FIXED && amountRow?.decimals === null) {
    // SANITY GATE ONLY — never the pricing input.
    //
    // The charge is scaled by the NODE's `defaultAssetDecimals`, carried on
    // `X402ReadySource` (the agent authors its own registry entry, and this
    // value divides the charge). What a null here still means is that the
    // registry row is half-registered: the listing refuses such a source, so
    // paying against one would break the "listed ⇒ payable" pairing this
    // matcher exists to hold. Refuse rather than pay against a row the
    // listing would not have shown.
    throw unprocessableEntity(
      `No decimals recorded for asset ${asset} on ${caip2Network}`,
    );
  }

  // Amount sanity vs the advertised registry pricing (PR1-SPEC §3.3): the
  // demand may be cheaper than the advertised fixed price (per-resource
  // pricing below the advertised ceiling charges fewer credits — safe), but
  // a demand ABOVE it is exactly the manipulated-402 overcharge this check
  // exists to stop.
  const demanded = BigInt(entry.amount);
  if (
    pricingType === PricingType.FIXED &&
    amountRow &&
    demanded > amountRow.amount
  ) {
    throw unprocessableEntity(
      `Demanded amount ${entry.amount} exceeds the agent's advertised price ${amountRow.amount.toString()} for ${caip2Network}/${asset}`,
    );
  }

  return {
    pricingType,
    caip2Network,
    asset,
    amount: entry.amount,
    payTo,
    domainName: trustedDomain.name,
    domainVersion: trustedDomain.version,
    entry,
  };
}
