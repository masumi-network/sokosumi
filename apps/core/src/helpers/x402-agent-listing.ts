import * as Sentry from "@sentry/node";
import type {
  AgentPaymentSource,
  AgentPaymentSourceAmount,
  CreditCost,
} from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import { EVM_ADDRESS_PATTERN } from "@sokosumi/masumi";
import { X402_SUPPORTED_SCHEMES } from "@sokosumi/masumi/schemas";
import { convertCentsToCredits } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import type {
  X402DynamicAgentPaymentSource,
  X402FixedAgentPaymentSource,
} from "@/schemas/x402-agent.schema";

import { calculateCentsFromX402Amount } from "./x402-pricing";
import type { X402ReadySource } from "./x402-readiness";
import { findX402ReadySource, isX402NetworkAllowed } from "./x402-readiness";

export interface X402ListingGateContext {
  /** CreditCost table rows; CAIP-19 keyed rows price the x402 assets. */
  creditCosts: CreditCost[];
  /** Buy-side ready (network, asset) pairs from getX402ReadySources. */
  readySources: readonly X402ReadySource[];
  /** Deployment environment, gates the per-env CAIP-2 network allowlist. */
  network: "Preprod" | "Mainnet";
}

export type X402AgentPaymentSourceRow = Pick<
  AgentPaymentSource,
  "network" | "payTo" | "pricingType" | "scheme"
> & {
  amounts: Pick<AgentPaymentSourceAmount, "unit" | "amount" | "decimals">[];
};

/**
 * Distinct pricing misconfigurations already reported to Sentry this process.
 *
 * The gates below run on every request-serving listing GET and again on every
 * pay attempt, so an unthrottled capture would let any authenticated caller
 * convert ONE lingering operator error into per-request Sentry volume
 * (`limit=100`, looped) — burning quota and drowning real alerts. The
 * misconfiguration is deployment STATE, not a request event: once per process
 * per distinct error is the signal's whole information content. A process
 * restart re-reports, which is the desired refresh cadence.
 *
 * Keys are error name + message (bounded: the duplicate-CreditCost message
 * carries a canonical CAIP-19 unit; the name keeps two different error
 * classes with one coincidental message from suppressing each other). The
 * cap guards the set against a pathological error source; overflowing it
 * clears the set — mirroring `reportUnknownPurchaseValue` — which costs at
 * most one repeated report per cycle instead of unbounded per-request volume
 * for every error past the cap.
 */
const REPORTED_PRICING_MISCONFIGURATION_CAP = 100;
const reportedPricingMisconfigurations = new Set<string>();
// The outer catch cannot trust key derivation for the values that land in it,
// so it throttles with this single flag instead of the set: one capture per
// process for ALL hostile values combined. Without it, a persistent hostile
// thrower would re-open the exact per-request Sentry volume the set above
// exists to close (its own header doc names the scenario).
let hasReportedHostileClassifierFailure = false;

/** Test-only: clears the once-per-process report dedupe between tests. */
export function resetX402PricingMisconfigurationReports(): void {
  reportedPricingMisconfigurations.clear();
  hasReportedHostileClassifierFailure = false;
}

/**
 * Best-effort dedupe key. BOTH arms can throw for hostile-enough values —
 * `String(error)` on a ToPrimitive failure, the Error arm on a throwing
 * `name`/`message` accessor — so the whole derivation is guarded, and even
 * the fallback is not airtight (Object.prototype.toString reads
 * Symbol.toStringTag, which a Proxy can poison): the caller's outer catch is
 * the actual never-throw floor. Everything the fallback catches shares the
 * one `[object …]` key; acceptable: no current thrower produces such values,
 * and colliding exotics still capture once.
 */
function toPricingMisconfigurationKey(error: unknown): string {
  try {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

/**
 * Classifies a `calculateCentsFromX402Amount` throw and reports
 * misconfigurations to Sentry (once per process per distinct error).
 *
 * Returns `false` only for the helper's own 422s — unpriced asset,
 * non-positive CreditCost row, bad legacy amounts — which the pay endpoint
 * enforces identically pre-charge. EVERYTHING else returns `true`: today that
 * is the duplicate-CreditCost 500, but the branch is deliberately the ELSE
 * arm rather than an `instanceof`+status allowlist of one, so a future
 * programming error in the pricing helper (a TypeError, an HTTPException from
 * a dual-loaded hono) surfaces as misconfiguration instead of silently
 * dropping agents as "unpriced" — the exact swallow this helper exists to
 * close.
 */
export function reportX402PricingMisconfiguration(error: unknown): boolean {
  try {
    if (error instanceof HTTPException && error.status < 500) {
      return false;
    }
    const key = toPricingMisconfigurationKey(error);
    if (!reportedPricingMisconfigurations.has(key)) {
      if (
        reportedPricingMisconfigurations.size >=
        REPORTED_PRICING_MISCONFIGURATION_CAP
      ) {
        reportedPricingMisconfigurations.clear();
      }
      reportedPricingMisconfigurations.add(key);
      Sentry.captureException(error);
    }
    return true;
  } catch {
    // THE never-throw floor. The guarded key derivation is not enough on its
    // own: the `error.status` read above runs before it and a hostile
    // accessor there would throw, and even the derivation's own fallback
    // reads Symbol.toStringTag, which a Proxy get-trap can poison. Anything
    // that hostile is by definition not a known 422, so classify it as
    // misconfiguration. Capture is throttled by the module flag, not the
    // set — key derivation is exactly what failed — so all hostile values
    // share one capture per process; distinct-per-key reporting is
    // deliberately given up to keep the volume bound. Give even the capture
    // no way to take the listing down.
    if (!hasReportedHostileClassifierFailure) {
      hasReportedHostileClassifierFailure = true;
      try {
        Sentry.captureException(error);
      } catch {
        // A value Sentry itself cannot serialize — nothing left to do safely.
      }
    }
    return true;
  }
}

/**
 * The identity gates every advertised x402 source must pass before either
 * builder advertises it — ONE implementation on purpose: the fixed and
 * dynamic builders both feed the pay endpoint's source matching, so a gate
 * fixed in one copy but not the other would let listing and pay drift apart
 * per pricing type.
 *
 * Scheme: `scheme` decides WHAT the payer signs, and the registry mirrors it
 * verbatim into a nullable column (`AgentPaymentSource.scheme`) — a Bazaar
 * entry writes `"exact"`, a Cardano or pre-x402 entry writes null (those are
 * filtered out before these gates; non-x402 rails are excluded per spec).
 * The allowlist is the SAME `X402_SUPPORTED_SCHEMES` the 402 parser and
 * settlement enforce, matched case-insensitively because registry text is
 * capitalized (`"Exact"`) while the wire value is lowercase. The pay-side
 * `sourceIdentityMatches` compares the demand's scheme against the source's
 * directly, so growing this allowlist cannot let a demand for one scheme
 * match a source registered for another.
 *
 * `payTo`: the pay endpoint's `payTo` comes out of an
 * EVM_ADDRESS_PATTERN-validated 402, so a recipient that is not an EVM
 * address can never be matched: listing it advertises a demand the pay
 * endpoint is guaranteed to reject after the coworker already called the
 * agent. Mixed case is accepted — the registry serves checksummed addresses
 * and only the dedupe key case-folds.
 *
 * The sibling registry columns `chain` and `paymentSourceType` are
 * deliberately NOT gated: both are free-form registry text with no fixed
 * vocabulary for EVM rails, so any predicate over them would be a guess. The
 * chain a payment settles on is pinned by the CAIP-2 `network` allowlist,
 * which is authoritative and checked here.
 */
function gateX402SourceIdentity(
  source: X402AgentPaymentSourceRow,
  environment: "Preprod" | "Mainnet",
):
  | { status: "ok"; payTo: string; caip2Network: string }
  | { status: "dropped"; reason: X402ListingDropReason } {
  const payTo = source.payTo?.trim() ?? "";
  if (!payTo) {
    return { status: "dropped", reason: "missing_pay_to" };
  }
  if (!EVM_ADDRESS_PATTERN.test(payTo)) {
    return { status: "dropped", reason: "malformed_pay_to" };
  }
  const scheme = source.scheme?.trim().toLowerCase();
  if (!X402_SUPPORTED_SCHEMES.some((supported) => supported === scheme)) {
    return { status: "dropped", reason: "unsupported_scheme" };
  }
  if (!isX402NetworkAllowed(source.network, environment)) {
    return { status: "dropped", reason: "network_not_allowed" };
  }
  return {
    status: "ok",
    payTo,
    caip2Network: source.network.trim().toLowerCase(),
  };
}

/**
 * Why an agent was not advertised. Carried out of the gate loop so the route
 * can report WHICH gate emptied a listing — "nothing registered", "nothing
 * priced", and "everything failed the network gate" are indistinguishable
 * from an empty array alone. Also carries the ONE non-drop tally
 * (`unpriced_dynamic_preview`) so the route's single per-request pipeline can
 * log that state too.
 */
export type X402ListingDropReason =
  /** Type-specific discovery endpoint is absent, malformed, or non-HTTP(S). */
  | "invalid_discovery_url"
  /** The agent registered no payment source at all. */
  | "no_payment_source"
  /** A source is FREE/DYNAMIC/UNKNOWN priced — no price to verify against. */
  | "pricing_not_fixed"
  /** A preview source is not DYNAMIC priced. */
  | "pricing_not_dynamic"
  /** A source records no `payTo` recipient. */
  | "missing_pay_to"
  /** A source's `payTo` is not a well-formed EVM address. */
  | "malformed_pay_to"
  /** A source advertises a scheme other than x402 `exact`. */
  | "unsupported_scheme"
  /** A source's CAIP-2 network is outside this environment's allowlist. */
  | "network_not_allowed"
  /** A FIXED source's amount rows are missing. */
  | "no_amount_rows"
  /** An amount row has no recorded decimals. */
  | "missing_decimals"
  /** The (network, asset) pair is not buy-side ready on the payment node. */
  | "not_buy_side_ready"
  /** The asset has no positive CAIP-19 `CreditCost` row. */
  | "unpriced_asset"
  /**
   * Multiple CreditCost rows normalize to one unit — an operator
   * configuration error, not a missing price. Reported to Sentry when
   * detected: adding another price row (the `unpriced_asset` remedy) makes
   * this state WORSE, so it must never be tallied as unpriced.
   */
  | "pricing_misconfigured"
  /** One (payTo, network, asset) triple is advertised at two prices. */
  | "conflicting_price"
  /**
   * NOT a drop — the agent stays listed as a non-payable dynamic preview,
   * but a source's network has buy-side-ready pairs, none is priced, and at
   * least one lacks a positive CreditCost row (a sibling pair may instead be
   * misconfigured — that signal is Sentry's, and the two are independent).
   * Tallied because the state is otherwise silent: the same operator error
   * on a fixed agent tallies as `unpriced_asset`, and the sync side records
   * the pair READY — so without this, "all dynamic agents non-payable" has
   * no surface naming the missing CreditCost row.
   */
  | "unpriced_dynamic_preview";

export type X402AgentListingResult =
  | { status: "listed"; paymentSources: X402FixedAgentPaymentSource[] }
  | { status: "dropped"; reason: X402ListingDropReason };

export type X402DynamicListingResult =
  | {
      status: "listed";
      isPayable: boolean;
      /**
       * True when some source's non-payability is specifically "ready but
       * unpriced": its network HAS buy-side-ready pairs, no probe succeeded,
       * and at least one threw the pricing helper's own 422 (a sibling pair
       * may additionally be misconfigured and have fired Sentry — the two
       * signals are independent). Set only when that source ended
       * non-payable, so `true` implies `isPayable: false`. The route tallies
       * it as `unpriced_dynamic_preview` — see that reason's doc.
       */
      hasUnpricedReadyPair: boolean;
      paymentSources: X402DynamicAgentPaymentSource[];
    }
  | { status: "dropped"; reason: X402ListingDropReason };

export type X402AgentPricingListingResult =
  | {
      status: "listed";
      pricingType: "fixed";
      isPayable: true;
      paymentSources: X402FixedAgentPaymentSource[];
    }
  | {
      status: "listed";
      pricingType: "dynamic";
      isPayable: boolean;
      /** See {@link X402DynamicListingResult} — carried through verbatim. */
      hasUnpricedReadyPair: boolean;
      paymentSources: X402DynamicAgentPaymentSource[];
    }
  | {
      status: "listed";
      pricingType: "mixed";
      isPayable: boolean;
      /** See {@link X402DynamicListingResult} — carried through verbatim. */
      hasUnpricedReadyPair: boolean;
      paymentSources: Array<
        X402FixedAgentPaymentSource | X402DynamicAgentPaymentSource
      >;
    }
  | { status: "dropped"; reason: X402ListingDropReason };

/**
 * Maps an x402 agent's registered payment sources to the listing response, or
 * reports why the agent must be dropped (PR1-SPEC §2, fail closed).
 *
 * Listed ⇒ payable is a per-AGENT promise: EVERY advertised source must pass
 * every gate, because the agent — not Soko — picks which source its 402
 * demands. A single unpayable source means a 402 the pay endpoint would have
 * to reject after the coworker already did the work of calling the agent, so
 * the agent is hidden instead:
 *
 * - the source advertises a fixed price (`FIXED` with at least one amount —
 *   Free/Dynamic/unknown pricing has no chargeable price to verify against),
 * - `payTo` is present and a well-formed EVM address (the pay endpoint
 *   verifies the 402's payTo against it),
 * - the scheme is x402 `exact` (see {@link X402_SUPPORTED_SCHEMES}),
 * - the CAIP-2 network is in the per-environment allowlist,
 * - the amount row records decimals at all (a registry sanity gate — the scale
 *   the charge actually uses comes from the ready pair, never from here),
 * - the (network, asset) pair is buy-side ready on the payment node, which is
 *   also where the advertised and charged `decimals` come from,
 * - the asset resolves to a positive CAIP-19 `CreditCost` row,
 * - no two amount rows advertise the same `(payTo, network, asset)` triple at
 *   different prices (see {@link toAdvertisedPriceKey}).
 */
export function buildX402AgentPaymentSources(
  paymentSources: readonly X402AgentPaymentSourceRow[],
  context: X402ListingGateContext,
): X402AgentListingResult {
  // No advertised source at all is "not payable now", not "free".
  if (paymentSources.length === 0) {
    return { status: "dropped", reason: "no_payment_source" };
  }

  // Advertised entries keyed by (payTo, network, asset) — the triple the pay
  // endpoint resolves a 402's demand against. Deduped agent-wide, not per
  // source: the pay side scans sources in order and stops at the first with a
  // matching asset, so a second source repeating the triple is the same
  // ambiguity as a repeat inside one source.
  const advertisedByTriple = new Map<string, X402FixedAgentPaymentSource>();
  const listed: X402FixedAgentPaymentSource[] = [];
  for (const source of paymentSources) {
    if (source.pricingType !== PricingType.FIXED) {
      return { status: "dropped", reason: "pricing_not_fixed" };
    }
    const identity = gateX402SourceIdentity(source, context.network);
    if (identity.status === "dropped") {
      return identity;
    }
    // A FIXED source whose amount rows are momentarily gone (registry replay
    // deletes and recreates them) has no advertised price to verify against.
    if (source.amounts.length === 0) {
      return { status: "dropped", reason: "no_amount_rows" };
    }
    const { payTo, caip2Network } = identity;
    for (const amount of source.amounts) {
      // Registry sanity ONLY — this value never reaches the charge or the
      // advertised entry (see the ready pair's `decimals` below). A FIXED row
      // that records no scale at all describes an amount nobody can interpret,
      // which is a malformed registry entry rather than a priced one, so the
      // agent still drops.
      if (amount.decimals === null) {
        return { status: "dropped", reason: "missing_decimals" };
      }
      // One canonical spelling per amount row, hoisted like `caip2Network`
      // above and used by the gates AND the advertised entry alike. Ingestion
      // keeps whatever the registry wrote, and each consumer canonicalizing
      // separately is what let a padded unit pass every gate while deduping as
      // a second asset — advertising one triple at two prices.
      const asset = amount.unit.trim().toLowerCase();
      const readySource = findX402ReadySource(
        caip2Network,
        asset,
        context.readySources,
      );
      if (!readySource) {
        return { status: "dropped", reason: "not_buy_side_ready" };
      }
      // The node's `defaultAssetDecimals` for this pair, NEVER the agent's
      // `amount.decimals`. The scale divides the charge, so an agent that
      // registers 18 for a 6-decimals USDC would advertise — and be charged —
      // 10^12 too little while Soko's managed wallet signs away the real
      // token, and the pay endpoint's ceiling check cannot catch it because it
      // compares the demand against that same agent-registered amount. The
      // ready pair is the only copy of this number Soko did not get from the
      // agent, and it already failed closed on anything unusable
      // (`getX402ReadySources` re-validates it with `isUsableAssetDecimals`).
      const decimals = readySource.decimals;
      let cents: bigint;
      try {
        // The ready pair travels as ONE argument: `findX402ReadySource` just
        // matched it on (caip2Network, asset), so its identity and its scale
        // provably describe the same asset. Passing them as loose scalars is
        // what would let a future edit price one asset with another's scale.
        cents = calculateCentsFromX402Amount(
          { pair: readySource, amount: amount.amount.toString() },
          context.creditCosts,
        );
      } catch (error) {
        // Only the helper's own 422s mean "unpriced" (pre-charge 422s the pay
        // endpoint enforces identically; bad legacy amounts land there too).
        // Anything else is a misconfiguration the pay path cannot surface for
        // fixed agents — its listing gate re-runs this very code — so this
        // catch is the only place it can reach an operator. Report it (once
        // per process) and drop under its own reason.
        if (reportX402PricingMisconfiguration(error)) {
          return { status: "dropped", reason: "pricing_misconfigured" };
        }
        return { status: "dropped", reason: "unpriced_asset" };
      }
      const advertised: X402FixedAgentPaymentSource = {
        caip2Network,
        asset,
        decimals,
        payTo,
        amount: amount.amount.toString(),
        credits: convertCentsToCredits(cents),
      };
      const tripleKey = toAdvertisedPriceKey(advertised);
      const alreadyAdvertised = advertisedByTriple.get(tripleKey);
      if (alreadyAdvertised) {
        if (
          alreadyAdvertised.amount !== advertised.amount ||
          alreadyAdvertised.decimals !== advertised.decimals
        ) {
          // Two prices for one triple. The pay endpoint resolves the triple to
          // exactly ONE amount row and rejects a demand above it, so which
          // price is real depends on unordered row identity — listed would
          // stop implying payable. Fail closed on the whole agent.
          //
          // Only `amount` can differ today: `decimals` now comes from the ready
          // pair, which the triple's own (network, asset) selects, so two
          // entries under one key always carry the same scale. The comparison
          // stays because it guards the invariant rather than the current
          // lookup — a scale that ever varied per row would be a second price.
          return { status: "dropped", reason: "conflicting_price" };
        }
        // Ingestion permits duplicate units within one source's fixed amounts
        // (agent-sync.projection zips decimals positionally). Rows that agree
        // are one advertised price, not two — including rows whose REGISTRY
        // decimals disagree, since that field no longer prices anything.
        continue;
      }
      advertisedByTriple.set(tripleKey, advertised);
      listed.push(advertised);
    }
  }

  // Unreachable via the gates above (a source with no amount rows already
  // dropped), but the response schema requires at least one advertised source,
  // so an empty list is a drop rather than a 500 on the way out.
  if (listed.length === 0) {
    return { status: "dropped", reason: "no_amount_rows" };
  }
  return { status: "listed", paymentSources: listed };
}

/**
 * Builds dynamic listings for authenticated discovery callers.
 *
 * Dynamic sources have no registered asset or amount: their runtime 402 is the
 * quote. A source is marked payable when its network has at least one node-ready
 * asset with a configured credit price. The pay endpoint still verifies the
 * actual demanded asset and requires maxCredits before charging. Sources stay
 * visible as non-payable previews when readiness is absent.
 */
export function buildX402DynamicAgentPaymentSources(
  paymentSources: readonly X402AgentPaymentSourceRow[],
  context: X402ListingGateContext,
): X402DynamicListingResult {
  if (paymentSources.length === 0) {
    return { status: "dropped", reason: "no_payment_source" };
  }
  if (
    paymentSources.some((source) => source.pricingType !== PricingType.DYNAMIC)
  ) {
    return { status: "dropped", reason: "pricing_not_dynamic" };
  }

  const listed: X402DynamicAgentPaymentSource[] = [];
  // Mirrors the fixed builder's `advertisedByTriple`, minus the asset a
  // dynamic source doesn't register: ingestion permits one registry entry to
  // repeat a source at distinct sourceIndex values, and a repeat is one
  // preview, not two. Skipped BEFORE the probe — the duplicate's probe
  // outcome is identical by construction, so neither payability nor the
  // unpriced flag can change. Only `payTo` needs the case-fold, for the same
  // reason as `toAdvertisedPriceKey`.
  const advertisedByPair = new Set<string>();
  let isPayable = true;
  let hasUnpricedReadyPair = false;
  for (const source of paymentSources) {
    const identity = gateX402SourceIdentity(source, context.network);
    if (identity.status === "dropped") {
      return identity;
    }
    const { payTo, caip2Network } = identity;
    const pairKey = `${payTo.toLowerCase()}|${caip2Network}`;
    if (advertisedByPair.has(pairKey)) {
      continue;
    }
    advertisedByPair.add(pairKey);
    // Probe EVERY matching pair, deliberately not `.some()`: a short-circuit
    // at the first healthy pair would leave a misconfigured pair sorted after
    // it unprobed — and this probe is that pair's only pre-pay signal (the
    // pay path would first surface it as a 500 after the coworker already
    // called the agent). Compose records one pair per chain today, so the
    // exhaustive scan costs nothing extra; the once-per-process report dedupe
    // bounds Sentry volume either way. Payability itself is unchanged: one
    // healthy priced pair suffices, and a misconfigured pair reads as
    // unpriced (fail closed) rather than payable.
    let hasPricedReadyAsset = false;
    let sawUnpricedReadyPair = false;
    for (const readySource of context.readySources) {
      // Normalized like `findX402ReadySource` on the fixed path — the cache
      // rows ARE canonical (getX402ReadySources lowercases on read), but a
      // raw compare would make this probe the one consumer that silently
      // depends on that, and a non-canonical row from any future context
      // builder would skip a priced pair here while the fixed gate matched
      // it — reopening the mixed-arm flag the comment below proves closed.
      if (readySource.caip2Network.trim().toLowerCase() !== caip2Network) {
        continue;
      }
      try {
        calculateCentsFromX402Amount(
          { pair: readySource, amount: "1" },
          context.creditCosts,
        );
        hasPricedReadyAsset = true;
      } catch (error) {
        // Same classification as the fixed path; silently converting an
        // operator error into `isPayable: false` would leave it with no loud
        // surface at all. A plain 422 (ready but no positive CreditCost row)
        // is not reported here — it feeds the per-source flag below and the
        // route's `unpriced_dynamic_preview` tally instead.
        if (!reportX402PricingMisconfiguration(error)) {
          sawUnpricedReadyPair = true;
        }
      }
    }
    // Flagged only when "ready but unpriced" is WHY this source is not
    // payable — a healthy pair alongside an unpriced one is a payable source
    // and must not tally as a problem.
    if (!hasPricedReadyAsset && sawUnpricedReadyPair) {
      hasUnpricedReadyPair = true;
    }
    isPayable &&= hasPricedReadyAsset;

    listed.push({
      pricingType: "dynamic",
      caip2Network,
      payTo,
    });
  }

  return {
    status: "listed",
    isPayable,
    hasUnpricedReadyPair,
    paymentSources: listed,
  };
}

/**
 * Builds the complete agent-level listing without assuming every source uses
 * one pricing mode. Registry pricing belongs to each source, and the payment
 * verifier deliberately supports overlapping FIXED and DYNAMIC registrations
 * while preserving the stronger fixed ceiling.
 */
export function buildX402AgentPricingListing(
  paymentSources: readonly X402AgentPaymentSourceRow[],
  context: X402ListingGateContext,
): X402AgentPricingListingResult {
  if (paymentSources.length === 0) {
    return { status: "dropped", reason: "no_payment_source" };
  }
  if (
    paymentSources.some(
      (source) =>
        source.pricingType !== PricingType.FIXED &&
        source.pricingType !== PricingType.DYNAMIC,
    )
  ) {
    return { status: "dropped", reason: "pricing_not_fixed" };
  }

  const fixedSources = paymentSources.filter(
    (source) => source.pricingType === PricingType.FIXED,
  );
  const dynamicSources = paymentSources.filter(
    (source) => source.pricingType === PricingType.DYNAMIC,
  );

  if (dynamicSources.length === 0) {
    const fixed = buildX402AgentPaymentSources(fixedSources, context);
    return fixed.status === "listed"
      ? {
          status: "listed",
          pricingType: "fixed",
          isPayable: true,
          paymentSources: fixed.paymentSources,
        }
      : fixed;
  }
  if (fixedSources.length === 0) {
    const dynamic = buildX402DynamicAgentPaymentSources(
      dynamicSources,
      context,
    );
    return dynamic.status === "listed"
      ? {
          status: "listed",
          pricingType: "dynamic",
          isPayable: dynamic.isPayable,
          hasUnpricedReadyPair: dynamic.hasUnpricedReadyPair,
          paymentSources: dynamic.paymentSources,
        }
      : dynamic;
  }

  const fixed = buildX402AgentPaymentSources(fixedSources, context);
  if (fixed.status === "dropped") {
    return fixed;
  }
  const dynamic = buildX402DynamicAgentPaymentSources(dynamicSources, context);
  if (dynamic.status === "dropped") {
    return dynamic;
  }
  return {
    status: "listed",
    pricingType: "mixed",
    isPayable: dynamic.isPayable,
    // Provably always false while the per-environment allowlist holds ONE
    // network: reaching this arm means a fixed source listed, i.e. its asset
    // is ready AND priced on the only network the dynamic sources can share —
    // so their probe finds that priced pair and the flag stays down. It is
    // propagated (not hardcoded false) so growing the allowlist cannot
    // silently lose the tally for a mixed agent whose dynamic network is a
    // DIFFERENT, unpriced chain; untestable until then for the same reason —
    // whoever grows the allowlist adds that test.
    hasUnpricedReadyPair: dynamic.hasUnpricedReadyPair,
    paymentSources: [...fixed.paymentSources, ...dynamic.paymentSources],
  };
}

/**
 * Identity of an advertised price: the `(payTo, network, asset)` triple a 402
 * demand is matched on. All three fields arrive canonical (trimmed, and
 * lowercase for network and asset), so the key only case-folds `payTo` — the
 * one field advertised in its registry spelling, because the registry serves
 * mixed-case checksummed EVM addresses and the pay side compares them
 * case-insensitively. Two spellings of one recipient are one recipient here.
 *
 * Canonicalizing at the assignment above rather than in this key is what keeps
 * the gates and the dedupe in agreement: a key that normalized more than the
 * advertised value would hide a padded asset that no 402 can ever match, and a
 * key that normalized less would let one triple be advertised twice.
 */
function toAdvertisedPriceKey(advertised: X402FixedAgentPaymentSource): string {
  return [
    advertised.payTo.toLowerCase(),
    advertised.caip2Network,
    advertised.asset,
  ].join("|");
}
