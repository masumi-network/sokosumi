import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";

import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";

/** Whose credits a spend takes. */
export interface CreditPayer {
  /**
   * The member charged. Null charges the Organization pool with no member and
   * no Seat (ADR 0057).
   */
  userId: string | null;
  /** Null is the person's personal credits. */
  organizationId: string | null;
  /**
   * The Project the work belongs to: its Project credits are spent first,
   * then the pool. Null sees only the pool (ADR 0067).
   */
  projectId: string | null;
}

/**
 * What a spend does with its price:
 * - `in_full`: the whole price or nothing. A price of zero is refused.
 * - `in_full_or_zero`: the same, and a price of zero is recorded as a debit
 *   of zero, which the caller's receipt points to.
 * - `up_to_balance`: the price, or what the balance holds when that is less.
 *   An empty balance pays nothing. A price of zero is refused.
 */
export type SpendMode = "in_full" | "in_full_or_zero" | "up_to_balance";

export interface SpendInput<Mode extends SpendMode = SpendMode> {
  /** The Network whose credits pay. The one place the Network is read. */
  scope: NetworkScope;
  /**
   * The caller's open transaction, on the side the caller opened it: the
   * debit commits or rolls back with the caller's own receipt, at the
   * caller's isolation level and retry rules. Every statement of the spend
   * runs on it. A legacy transaction is one of the shared side.
   */
  tx: { shared: SharedDb } | { network: NetworkDb };
  payer: CreditPayer;
  /** The price, in cents. */
  quotedCents: bigint;
  mode: Mode;
}

/** The price was paid in full: one debit of the price. */
export interface SpendCharged {
  outcome: "charged";
  transactionId: string;
  quotedCents: bigint;
  chargedCents: bigint;
  shortfall: false;
}
/** The balance held less than the price: one debit of what it held. */
export interface SpendPartlyCharged {
  outcome: "partly_charged";
  transactionId: string;
  quotedCents: bigint;
  /** Above zero and below the price. */
  chargedCents: bigint;
  shortfall: true;
}
/** The price was zero: one debit of zero, with no credits taken. */
export interface SpendRecordedZero {
  outcome: "recorded_zero";
  transactionId: string;
  quotedCents: 0n;
  chargedCents: 0n;
  shortfall: false;
}
/** The credits do not cover the price: nothing was written. */
export interface SpendNotCharged {
  outcome: "not_charged";
  transactionId: null;
  quotedCents: bigint;
  chargedCents: 0n;
  shortfall: true;
  /** What the payer's credits could cover. */
  availableCents: bigint;
}

interface SpendResults {
  in_full: SpendCharged | SpendNotCharged;
  in_full_or_zero: SpendCharged | SpendRecordedZero | SpendNotCharged;
  up_to_balance: SpendCharged | SpendPartlyCharged | SpendNotCharged;
}
export type SpendResult<Mode extends SpendMode = SpendMode> =
  SpendResults[Mode];

/**
 * The errors a spend threw while it prepared, before it wrote anything. Kept
 * beside the error, not on it and not around it: `spend` always throws the
 * original error, so a caller that maps nothing, and the retry of
 * `retriedTransaction` above it, see exactly what they saw before the debit
 * moved here, a transaction conflict included.
 */
const failedInPreparation = new WeakSet<object>();

/**
 * True when `spend` threw this error before it wrote anything, while it read
 * the balance or the buckets: any failure of that stage, a transaction
 * conflict included. False for a failure of the write. A caller that answers
 * a failed preparation with its own status asks this in its `catch`; the
 * error itself is the original, to keep as the `cause`.
 */
export function spendFailedInPreparation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    failedInPreparation.has(error)
  );
}

/** The reads before the write: a failure here is marked as one of this stage. */
async function prepared<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      !(error instanceof InsufficientBalanceError)
    ) {
      failedInPreparation.add(error);
    }
    throw error;
  }
}

/**
 * Spends the payer's credits for a price: the soonest expiring credits first,
 * a Project's own before the pool. The module owns which credits pay and the
 * rows of the debit. The caller owns who may spend, the price, the
 * transaction and its retries, and its own receipt, which is also how it
 * knows a repeated call is already paid.
 */
export async function spend(
  input: SpendInput<"in_full">,
): Promise<SpendResult<"in_full">>;
export async function spend(
  input: SpendInput<"in_full_or_zero">,
): Promise<SpendResult<"in_full_or_zero">>;
export async function spend(
  input: SpendInput<"up_to_balance">,
): Promise<SpendResult<"up_to_balance">>;
export async function spend(input: SpendInput): Promise<SpendResult> {
  const { scope, tx, payer, quotedCents, mode } = input;
  const { userId, organizationId, projectId } = payer;
  const { network } = scope;
  const record = (cents: bigint, consumptions: Consumptions) =>
    creditBucketRepository.recordSpend(
      network,
      { userId, organizationId, cents, consumptions },
      "shared" in tx ? tx.shared : tx.network,
    );

  if (mode === "in_full_or_zero" && quotedCents === 0n) {
    return {
      outcome: "recorded_zero",
      transactionId: await record(0n, []),
      quotedCents: 0n,
      chargedCents: 0n,
      shortfall: false,
    };
  }

  let chargedCents = quotedCents;
  if (mode === "up_to_balance" && quotedCents > 0n) {
    const balance = await prepared(() =>
      creditBucketRepository.getBalanceOn(network, userId, organizationId, tx, {
        projectId,
      }),
    );
    if (balance < quotedCents) chargedCents = balance;
    if (chargedCents <= 0n) {
      return {
        outcome: "not_charged",
        transactionId: null,
        quotedCents,
        chargedCents: 0n,
        shortfall: true,
        availableCents: balance,
      };
    }
  }

  let consumptions: Consumptions;
  try {
    consumptions = await prepared(() =>
      creditBucketRepository.prepareConsumptionOn(
        network,
        userId,
        organizationId,
        chargedCents,
        tx,
        { projectId },
      ),
    );
  } catch (error) {
    if (!(error instanceof InsufficientBalanceError)) throw error;
    return {
      outcome: "not_charged",
      transactionId: null,
      quotedCents,
      chargedCents: 0n,
      shortfall: true,
      availableCents: error.available,
    };
  }
  const transactionId = await record(chargedCents, consumptions);
  return chargedCents < quotedCents
    ? {
        outcome: "partly_charged",
        transactionId,
        quotedCents,
        chargedCents,
        shortfall: true,
      }
    : {
        outcome: "charged",
        transactionId,
        quotedCents,
        chargedCents,
        shortfall: false,
      };
}

type Consumptions = Awaited<
  ReturnType<typeof creditBucketRepository.prepareConsumptionOn>
>;
