import { createHash } from "node:crypto";

import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import {
  canonicalJsonKey,
  narrowToChosenRequirement,
  type X402NormalizedRequirementSource,
  type X402PaymentRequired,
  type X402PaymentRequirements,
} from "@sokosumi/masumi/schemas";
import { HTTPException } from "hono/http-exception";

import { getEnv } from "@/config/env";
import { badGateway, conflict, internalServerError } from "@/helpers/error";
import {
  verifyX402DemandAgainstAgentSources,
  type X402VerifiedDemand,
} from "@/helpers/x402-payment-verify";
import {
  getX402AgentCatalogWhere,
  hasValidX402DiscoveryUrl,
} from "@/helpers/x402-readiness";
import { PARKED_IDENTIFIER_PREFIX } from "@/services/agent-sync.consolidation";
import type { StoredTaskX402Payment } from "@/services/task-x402-payment.replay";

/**
 * Demand-identity concern for x402 replay resolution, split from
 * `task-x402-payment.replay` along the evidence boundary the resolver
 * enforces: everything here answers "is the supplied 402 the demand the
 * stored charge paid for, and is the supplied agent the stored agent?" —
 * the fingerprint, the catalog-free reproduction proof, the alias-aware
 * identity check, the catalog re-verification, and the two answer builders
 * (`reusedKeyConflict` for PROVEN mismatches, `pendingReplayHeld` for
 * catalog-state failures). The resolver itself (WHEN a record may reach the
 * node: caps, lease, fences) stays in `task-x402-payment.replay`.
 */

/**
 * The subset of the pay input a replay needs to re-verify a supplied 402.
 *
 * The 402 arrives ALREADY NORMALIZED: parsing is attacker-sized work (base64
 * decode, `JSON.parse`, the prototype-key sanitizer walk, BigInt conversions)
 * and the caller does it before the serializable charge transaction opens.
 */
export interface X402ReplayVerification {
  agentId: string;
  normalized: X402PaymentRequired;
  /** Original resource-server spellings paired with each normalized accept. */
  requirementSources: readonly X402NormalizedRequirementSource[];
}

export function sourceRequirementForEntry(
  normalized: X402PaymentRequired,
  requirementSources: readonly X402NormalizedRequirementSource[],
  entry: X402PaymentRequirements,
): Readonly<Record<string, unknown>> {
  const index = normalized.accepts.indexOf(entry);
  const source = requirementSources[index];
  if (!source || source.normalized !== entry) {
    throw internalServerError(
      "x402 normalized requirement lost its resource-server source spelling",
    );
  }
  return source.source;
}

/**
 * Stable identity for one payable choice, including protocol-level fields and
 * the resource server's exact accepted-term spelling. Alternatives are
 * excluded because the node receives one narrowed entry; top-level resource
 * and extension fields remain because they can change replay semantics.
 */
export function createX402DemandFingerprint(
  normalized: X402PaymentRequired,
  sourceRequirement: Readonly<Record<string, unknown>>,
): string {
  const canonical = canonicalJsonKey({ normalized, sourceRequirement });
  if (canonical === undefined) {
    throw internalServerError("x402 payment demand could not be canonicalized");
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The payload actually forwarded to the node: the verified 402 rebuilt with a
 * SINGLE `accepts` entry, the one that matched a registered payment source.
 *
 * `POST /x402/pay` receives the whole payload and the NODE decides which entry
 * it signs; nothing node-side constrains `payTo`. Two Soko-side fences narrow
 * that already — `verifyX402DemandAgainstAgentSources` refuses a 402 whose
 * same-(network, asset) entries disagree, and the call sends
 * `preferredNetwork`/`preferredAsset` — but an entry for a DIFFERENT asset on
 * the same chain meets neither, so it is filtered only if the node honours
 * `preferredAsset`: a fail-open-on-version-skew dependency on a node this repo
 * does not deploy. One entry makes the node's selection rule irrelevant.
 *
 * An error here is unreachable by construction — `entry` is an element of
 * `normalized.accepts`, and the narrowed payload is the validated one minus
 * entries — so it is a loud 500 rather than a guess. On the fresh path it is
 * evaluated after the debit, the task event and the record insert, but inside
 * the SAME SERIALIZABLE transaction as all three: a throw rolls the charge
 * back with them, so nothing is charged for a payload that was never
 * forwarded.
 */
export function narrowOrThrow(
  normalized: X402PaymentRequired,
  entry: X402PaymentRequirements,
): X402PaymentRequired {
  const narrowed = narrowToChosenRequirement(normalized, entry);
  if (narrowed.isErr()) {
    throw internalServerError(
      `x402 payload could not be narrowed to the verified requirement: ${narrowed.error}`,
    );
  }
  return narrowed.value;
}

/**
 * The listed x402 agent for a payable id, or null. Same environment-aware SQL
 * gates as the listing: type and status everywhere, plus curation on Mainnet.
 * Preprod intentionally permits hidden online entries; offline entries never
 * remain payable through a remembered id.
 */
export async function findListedX402Agent(
  agentId: string,
  tx: Prisma.TransactionClient,
) {
  const network = getEnv().NETWORK;
  const agent = await tx.agent.findFirst({
    where: {
      id: agentId,
      ...getX402AgentCatalogWhere(network),
    },
    include: {
      paymentSources: {
        // The normalized demand is always `exact`, but registry source data is
        // independent. Keep unsupported signing contracts out so an agent
        // hidden by the listing cannot still be paid through a remembered id.
        where: {
          scheme: { not: null },
        },
        include: {
          // Both relations are explicitly ordered, mirroring the listing
          // query. Unordered, Prisma returns Postgres heap order, so the
          // matcher's `find` — "the first amount row for this asset" — could
          // resolve to a different row here than the one the listing
          // advertised a price for. Ingestion deliberately permits duplicate
          // units within one source, so identical ordering on both sides is
          // what makes listing and pay agree on row identity; a unique on
          // (paymentSourceId, unit) would instead break the sync.
          amounts: { orderBy: [{ unit: "asc" }, { id: "asc" }] },
        },
        orderBy: { sourceIndex: "asc" },
      },
    },
  });
  return agent && hasValidX402DiscoveryUrl(agent) ? agent : null;
}

/**
 * A PENDING replay must re-run the SAME verification the fresh path runs —
 * over the FULL supplied 402 — and land byte-for-byte on the stored
 * (caip2Network, asset, payTo, amount) tuple.
 *
 * Why the full re-verification and not a `.some()` match against the stored
 * tuple: the node is restricted only by preferredNetwork/preferredAsset, so it
 * may sign ANY entry sharing the stored pair. A replay carrying the stored
 * entry PLUS a sibling on the same pair ({huge amount, attacker payTo}) would
 * pass a `.some()` check, be forwarded whole, and let the node sign the
 * sibling — paying the attacker at the original small credit price, then
 * overwriting the record with the attacker's tuple on finalize.
 * `verifyX402DemandAgainstAgentSources` rejects a 402 whose same-pair entries
 * disagree, which is exactly what closes that hole; running it here means the
 * node is never forwarded a 402 whose stored-pair entries aren't all equal to
 * what was originally verified, and a VERIFIED header is never returned for a
 * request that no longer verifies to it. VERIFIED replay uses the immutable
 * stored tuple instead because it never calls the node again.
 *
 * By the time this runs, the catalog-free fingerprint proof in
 * `resolveExistingPayment` has already established that the supplied 402
 * REPRODUCES the stored demand. So a failure here — the agent dropped out of
 * the listing, the registry no longer verifies the demand, or verification
 * selects a different entry — is CATALOG DRIFT under an unchanged intent,
 * never key reuse. Answering the key-reused 409 on these arms would instruct
 * a new idempotencyKey — a second charge — while the held charge and a
 * possibly-live authorization from an earlier ambiguous attempt exist.
 * Instead the charge stays held: page ops and answer the held-PENDING 502;
 * catalog recovery (or support) unblocks the same key. Returns the
 * normalized 402 to re-sign.
 */
export async function assertReplayMatchesStoredDemand(
  existing: StoredTaskX402Payment,
  input: X402ReplayVerification,
  tx: Prisma.TransactionClient,
): Promise<{
  normalized: X402PaymentRequired;
  sourceRequirement: Readonly<Record<string, unknown>>;
  domainName: string;
  domainVersion: string;
}> {
  const normalized = input.normalized;
  const agent = await findListedX402Agent(existing.agentId, tx);
  if (!agent) {
    // Listing state is transient (uptime flap, curation toggle) and proves
    // nothing about the demand — which the fingerprint proof has already
    // matched. Hold; the same key re-signs once the listing recovers.
    throw pendingReplayHeld(existing, "the agent is no longer listed");
  }

  let demand: X402VerifiedDemand;
  try {
    demand = verifyX402DemandAgainstAgentSources(
      normalized.accepts,
      agent.paymentSources,
      getEnv().NETWORK,
    );
  } catch (error) {
    // The verifier's own 422s here mean the fingerprint-proven demand no
    // longer verifies against TODAY'S registry state (the agent re-registered
    // payTo, dropped the pair, changed its price) — drift, not key reuse.
    // Anything else is a programming error or infrastructure failure:
    // rethrow it as itself.
    if (!(error instanceof HTTPException) || error.status !== 422) {
      throw error;
    }
    throw pendingReplayHeld(
      existing,
      "the demand no longer verifies against the listed agent",
    );
  }

  if (
    demand.caip2Network !== existing.caip2Network ||
    demand.asset !== existing.asset ||
    demand.amount !== existing.amount ||
    demand.payTo.toLowerCase() !== existing.payTo.toLowerCase()
  ) {
    // Verification succeeded but selected an entry off the stored tuple —
    // possible only when registry drift re-shaped which entries verify. The
    // stored demand is still what the coworker is replaying (proven), so
    // never sign the drifted selection and never burn the key.
    throw pendingReplayHeld(
      existing,
      "verification selected a different entry than the stored demand",
    );
  }
  // Narrowed for the same reason the fresh path narrows: a re-sign forwards
  // this payload to the node, so the replay must not widen the node's choice
  // back out to every entry the caller sent.
  return {
    normalized: narrowOrThrow(normalized, demand.entry),
    sourceRequirement: sourceRequirementForEntry(
      normalized,
      input.requirementSources,
      demand.entry,
    ),
    domainName: demand.domainName,
    domainVersion: demand.domainVersion,
  };
}

/**
 * The one construction site for the key-reused 409. The advice text is
 * load-bearing coworker guidance ("use a new idempotencyKey" is only safe
 * because every path throwing this has proven the supplied 402 is NOT the
 * stored demand), so it must not drift between the resolvers. On the PENDING
 * path that proof is structural: the catalog-free fingerprint proof runs
 * before any catalog read, and catalog-state failures answer
 * {@link pendingReplayHeld} instead.
 */
export function reusedKeyConflict(detail: string): HTTPException {
  return conflict(
    `This idempotencyKey was used with ${detail}; use a new idempotencyKey`,
    { kind: "x402_payment_key_reused" },
  );
}

/**
 * The one construction site for the held-PENDING 502 a replay answers when
 * TODAY'S catalog state blocks a re-sign of a fingerprint-proven demand:
 * agent unlisted, demand no longer verifying, drifted selection, or the
 * (network, asset) pair no longer buy-side ready. The held charge stays
 * PENDING behind its sign-risk fence; nothing auto-refunds it, so every
 * throw pages ops first — a stuck PENDING charge would otherwise be
 * invisible until support hears about it. The same key retries once the
 * catalog recovers; a new key would charge twice.
 */
export function pendingReplayHeld(
  existing: StoredTaskX402Payment,
  why: string,
): HTTPException {
  Sentry.captureMessage(`x402 PENDING replay held: ${why}`, {
    level: "warning",
    tags: { error_type: "task_x402_payment_pending_held" },
    extra: {
      paymentId: existing.id,
      caip2Network: existing.caip2Network,
      asset: existing.asset,
    },
  });
  return badGateway(
    `This x402 payment cannot be re-signed right now: ${why}. ` +
      "The held charge stays on a pending record; retry with the SAME idempotencyKey later or contact support. A new key would charge twice.",
    { kind: "x402_pay_pending_held" },
  );
}

/**
 * Same-key replay identity across agent consolidation. Registry sync parks a
 * rollback-era duplicate agent and repoints its x402 payment rows to the
 * canonical id (`consolidateDuplicateAgentRelations`), so a coworker replaying
 * its ORIGINAL request — same 402, same agentId it originally paid — no longer
 * matches `existing.agentId`. That replay is the same intent, not key reuse:
 * answering the key-reused 409 would instruct a second charge (PENDING) or
 * strand an already-paid header (VERIFIED). Accept the supplied id when it is
 * a parked duplicate whose original identifier now belongs to the stored
 * canonical agent; every other mismatch stays a reused key. The demand
 * fingerprint and stored-tuple checks still run after this — identity here
 * never weakens what the replay must match.
 */
export async function assertReplayAgentIdentity(
  existing: StoredTaskX402Payment,
  suppliedAgentId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (existing.agentId === suppliedAgentId) {
    return;
  }
  const supplied = await tx.agent.findUnique({
    where: { id: suppliedAgentId },
    select: { blockchainIdentifier: true },
  });
  // Parked identifiers are `legacy-v2:<duplicateId>:<originalIdentifier>`;
  // the canonical row keeps the original identifier. A chain deeper than one
  // park fails closed to the reused-key answer.
  const parkedPrefix = `${PARKED_IDENTIFIER_PREFIX}${suppliedAgentId}:`;
  if (supplied?.blockchainIdentifier.startsWith(parkedPrefix)) {
    const originalIdentifier = supplied.blockchainIdentifier.slice(
      parkedPrefix.length,
    );
    // Case-insensitive to match consolidation's own duplicate matching
    // (`lower("blockchainIdentifier") = lower(...)` in the sync): a
    // rollback-era duplicate stored the registry's spelling verbatim while
    // the canonical row normalizes to lowercase, so a byte-exact lookup
    // would miss exactly the rows consolidation parks.
    const canonical = await tx.agent.findFirst({
      where: {
        blockchainIdentifier: {
          equals: originalIdentifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    if (canonical?.id === existing.agentId) {
      return;
    }
  }
  throw reusedKeyConflict("a different agent");
}

export function requireStoredDemandFingerprint(
  existing: StoredTaskX402Payment,
): string {
  if (existing.demandFingerprint === null) {
    throw conflict(
      "This x402 payment predates exact replay binding. Contact support and do not create a new idempotencyKey; the original charge may still have a live authorization.",
      { kind: "x402_payment_demand_unbound" },
    );
  }
  return existing.demandFingerprint;
}

/**
 * Catalog-free proof that the supplied 402 REPRODUCES the stored demand —
 * the sole evidence a replay resolver may cite before answering the
 * key-reused 409, because it depends only on the supplied request and the
 * immutable payment row, never on today's catalog.
 *
 * Every supplied entry on the stored pair must retain the stored amount and
 * recipient, and at least one must reproduce the canonical fingerprint of the
 * selected protocol payload and exact source requirement. Other same-pair
 * siblings may differ in selection-only terms because the fresh path narrowed
 * them away before signing. Other pairs remain allowed too.
 */
export function suppliedDemandReproducesStored(
  existing: StoredTaskX402Payment,
  input: X402ReplayVerification,
): boolean {
  const storedFingerprint = requireStoredDemandFingerprint(existing);

  const matchingPair = input.normalized.accepts
    .map((entry, index) => ({
      entry,
      source: input.requirementSources[index],
    }))
    .filter(
      ({ entry }) =>
        entry.network === existing.caip2Network &&
        entry.asset === existing.asset,
    );
  const allMatchStoredTuple = matchingPair.every(
    ({ entry, source }) =>
      source?.normalized === entry &&
      entry.amount === existing.amount &&
      entry.payTo.toLowerCase() === existing.payTo.toLowerCase(),
  );
  const includesStoredSelection = matchingPair.some(({ entry, source }) => {
    if (!source || source.normalized !== entry) return false;
    return (
      createX402DemandFingerprint(
        narrowOrThrow(input.normalized, entry),
        source.source,
      ) === storedFingerprint
    );
  });
  return (
    matchingPair.length > 0 && allMatchStoredTuple && includesStoredSelection
  );
}

/**
 * A terminal VERIFIED replay depends only on the immutable payment row, never
 * on today's catalog. The original charge already pinned the agent and tuple;
 * hiding the agent or editing its registry entry cannot revoke the bearer
 * header the caller bought. A failed proof IS key reuse here: nothing mutable
 * participated in the comparison.
 */
export function assertVerifiedReplayReferencesStoredDemand(
  existing: StoredTaskX402Payment,
  input: X402ReplayVerification,
): void {
  if (!suppliedDemandReproducesStored(existing, input)) {
    throw reusedKeyConflict("a different payment demand");
  }
}
