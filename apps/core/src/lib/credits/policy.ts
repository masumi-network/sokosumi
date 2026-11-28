import type { Network } from "@/lib/network";

/**
 * Whether a Network's credits are charged. Preprod costs no credits (the
 * user, 2026-11-26): a Preprod payment is recorded with its price and takes
 * nothing, and there is no Preprod balance, plan or grant. The Preprod
 * credit tables stay, empty of buckets and consumptions.
 *
 * The one place the credits module tells the Networks apart: a payer or a
 * reader asks the module, never the Network itself. A Network added to
 * `Network` fails to compile here until it is decided.
 */
const CHARGES_CREDITS = {
  mainnet: true,
  preprod: false,
} as const satisfies Record<Network, boolean>;

/** True when a spend on `network` takes credits, false when it is only recorded. */
export function chargesCredits(network: Network): boolean {
  return CHARGES_CREDITS[network];
}

/**
 * Whether the shared rows that name no Network are this Network's: a
 * receipt written before `taskEvent.network` existed, and every receipt of a
 * Mainnet-only feature (images, SEO chat, contact search), which has no
 * Network column. All of them are Mainnet's. Another Network's ledger reads a
 * shared receipt only when it names that Network, so equal ids on two
 * Networks never cross.
 */
const OWNS_UNTAGGED_SHARED_ROWS = {
  mainnet: true,
  preprod: false,
} as const satisfies Record<Network, boolean>;

export function ownsUntaggedSharedRows(network: Network): boolean {
  return OWNS_UNTAGGED_SHARED_ROWS[network];
}

/**
 * The payers that can run on a Network that charges no credits: their
 * payment there is recorded with its price. Every other payer is a
 * Mainnet-only feature or always charges Mainnet (Soko Bot turns, ticket 30).
 */
const RECORDED_KINDS = ["job_hire", "task_credits", "coworker_usage"] as const;

export type RecordedSpendKind = (typeof RECORDED_KINDS)[number];

/** What a spend pays for: names the payer, for the policy above. */
export type SpendKind =
  | RecordedSpendKind
  | "seo_chat"
  | "competitor_check"
  | "soko_bot_turn";

/**
 * Throws unless a spend of `kind` may be recorded on `network`, which charges no
 * credits: a later mistake that hands a Mainnet-only payer such a scope
 * fails before anything is written.
 */
export function requireRecordedSpendKind(
  kind: SpendKind,
  network: Network,
): asserts kind is RecordedSpendKind {
  if (!(RECORDED_KINDS as readonly SpendKind[]).includes(kind)) {
    throw new Error(
      `${kind} spends Mainnet credits only, and was given the ${network} scope, which charges no credits`,
    );
  }
}

/**
 * Throws unless `network` charges credits: for the operations that exist
 * only where credits are kept (a grant, a write-off, a balance).
 */
export function requireChargingNetwork(network: Network, what: string): void {
  if (!chargesCredits(network)) {
    throw new Error(
      `${what} is Mainnet's only: ${network} charges no credits, so it has none`,
    );
  }
}
