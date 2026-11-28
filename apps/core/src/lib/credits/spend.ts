import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";

import type { NetworkScope, SharedDb } from "@/lib/db/network-scope";

import {
  chargesCredits,
  type RecordedSpendKind,
  requireRecordedSpendKind,
  type SpendKind,
} from "./policy";

export type { RecordedSpendKind, SpendKind } from "./policy";

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

export interface SpendInput<
  Mode extends SpendMode = SpendMode,
  Kind extends SpendKind = SpendKind,
> {
  /** The Network whose credits pay. The one place the Network is read. */
  scope: NetworkScope;
  /**
   * What the spend pays for. On a Network that charges no credits (Preprod)
   * only a Job hire, a Task's credits and Coworker usage are recorded; any
   * other kind is refused there before anything is written.
   */
  kind: Kind;
  /**
   * The caller's open transaction, of the shared side: the debit commits or
   * rolls back with the caller's own receipt, at the caller's isolation level
   * and retry rules. Every statement of the spend runs on it; the Network's
   * rows are written through it in raw SQL. A legacy transaction is one of
   * the shared side.
   */
  tx: SharedDb;
  payer: CreditPayer;
  /** The price, in cents. */
  quotedCents: bigint;
  mode: Mode;
}

/** The price was paid in full: one debit of the price. */
export interface SpendCharged {
  outcome: "charged";
  transactionId: string;
  /**
   * The debit's creation time, which its consumptions share: a receipt
   * written after it in the same transaction takes it as its own, so the
   * two read as one instant, as one nested create wrote them.
   */
  createdAt: Date;
  quotedCents: bigint;
  chargedCents: bigint;
  shortfall: false;
}
/** The balance held less than the price: one debit of what it held. */
export interface SpendPartlyCharged {
  outcome: "partly_charged";
  transactionId: string;
  /** See `SpendCharged.createdAt`. */
  createdAt: Date;
  quotedCents: bigint;
  /** Above zero and below the price. */
  chargedCents: bigint;
  shortfall: true;
}
/** The price was zero: one debit of zero, with no credits taken. */
export interface SpendRecordedZero {
  outcome: "recorded_zero";
  transactionId: string;
  /** See `SpendCharged.createdAt`. */
  createdAt: Date;
  quotedCents: 0n;
  chargedCents: 0n;
  shortfall: false;
}
/** The credits do not cover the price: nothing was written. */
export interface SpendNotCharged {
  outcome: "not_charged";
  transactionId: null;
  createdAt: null;
  quotedCents: bigint;
  chargedCents: 0n;
  shortfall: true;
  /** What the payer's credits could cover. */
  availableCents: bigint;
}

/**
 * The Network charges no credits (Preprod): one debit of the price is
 * recorded on its own tables, which the caller's receipt points to, and no
 * credits are taken. Not a charge: there was no balance to read.
 */
export interface SpendRecordedNotCharged {
  outcome: "recorded_not_charged";
  transactionId: string;
  /** See `SpendCharged.createdAt`. */
  createdAt: Date;
  quotedCents: bigint;
  chargedCents: 0n;
  shortfall: false;
}

interface SpendResults {
  in_full: SpendCharged | SpendNotCharged;
  in_full_or_zero: SpendCharged | SpendRecordedZero | SpendNotCharged;
  up_to_balance: SpendCharged | SpendPartlyCharged | SpendNotCharged;
}
/** What a spend answers: a kind recorded on Preprod adds `recorded_not_charged`. */
export type SpendResult<
  Mode extends SpendMode = SpendMode,
  Kind extends SpendKind = SpendKind,
> =
  | SpendResults[Mode]
  | (Kind extends RecordedSpendKind ? SpendRecordedNotCharged : never);

/**
 * The errors whose latest throw by a spend came from its preparation. Kept
 * beside the error, not on it and not around it: `spend` always throws the
 * original error, so a caller that maps nothing, and the retry of
 * `retriedTransaction` above it, see exactly what they saw before the debit
 * moved here, a transaction conflict included.
 */
const thrownInPreparation = new WeakSet<object>();

/**
 * True when the spend that just threw this error failed before it wrote
 * anything: while it read its scope, the balance or the buckets. Any failure
 * of that stage counts, a transaction conflict included. False when the write
 * failed. A caller that answers a failed preparation with its own status asks
 * this in the `catch` around its call; the error is the original, to keep as
 * the `cause`. The answer is about the latest spend that threw the error: the
 * same error thrown again by a write is a failed write.
 */
export function spendFailedInPreparation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    thrownInPreparation.has(error)
  );
}

function markStage(error: unknown, stage: "preparation" | "write"): void {
  if (typeof error !== "object" || error === null) return;
  if (stage === "preparation") thrownInPreparation.add(error);
  else thrownInPreparation.delete(error);
}

/** One step of a spend: what it throws is marked with the step's stage. */
async function inStage<T>(
  stage: "preparation" | "write",
  step: () => T | Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    markStage(error, stage);
    throw error;
  }
}

/**
 * Spends the payer's credits for a price: the soonest expiring credits first,
 * a Project's own before the pool. The module owns which credits pay and the
 * rows of the debit. The caller owns who may spend, the price, the
 * transaction and its retries, and its own receipt, which is also how it
 * knows a repeated call is already paid.
 *
 * The transaction is the shared side's, as every payer opens it today. A
 * Network-side transaction is added by the ticket that moves a payer to that
 * side, with its own proof that the plan and the Seat are read the same.
 */
export async function spend<Kind extends SpendKind>(
  input: SpendInput<"in_full", Kind>,
): Promise<SpendResult<"in_full", Kind>>;
export async function spend<Kind extends SpendKind>(
  input: SpendInput<"in_full_or_zero", Kind>,
): Promise<SpendResult<"in_full_or_zero", Kind>>;
export async function spend<Kind extends SpendKind>(
  input: SpendInput<"up_to_balance", Kind>,
): Promise<SpendResult<"up_to_balance", Kind>>;
export async function spend(input: SpendInput): Promise<SpendResult> {
  const { scope, tx, kind, payer, quotedCents, mode } = input;
  const { userId, organizationId, projectId } = payer;
  // A scope that refuses its Network throws here: a failed preparation.
  const network = await inStage("preparation", () => scope.network);
  const charges = chargesCredits(network);
  if (!charges) {
    await inStage("preparation", () => requireRecordedSpendKind(kind, network));
  }
  const record = async (cents: bigint, consumptions: Consumptions) => {
    const createdAt = new Date();
    const transactionId = await inStage("write", () =>
      creditBucketRepository.recordSpend(
        network,
        { userId, organizationId, cents, consumptions, createdAt },
        tx,
      ),
    );
    return { transactionId, createdAt };
  };

  if (mode === "in_full_or_zero" && quotedCents === 0n) {
    return {
      outcome: "recorded_zero",
      ...(await record(0n, [])),
      quotedCents: 0n,
      chargedCents: 0n,
      shortfall: false,
    };
  }

  if (!charges) {
    // No balance, bucket, Seat or plan read: they choose credits, and none
    // are taken. A price of zero is refused, as the bucket choice refuses it.
    if (quotedCents <= 0n) {
      await inStage("preparation", () => {
        throw new Error("Cents to consume must be positive");
      });
    }
    return {
      outcome: "recorded_not_charged",
      ...(await record(quotedCents, [])),
      quotedCents,
      chargedCents: 0n,
      shortfall: false,
    };
  }

  let chargedCents = quotedCents;
  if (mode === "up_to_balance" && quotedCents > 0n) {
    const balance = await inStage("preparation", () =>
      creditBucketRepository.getNetworkBalance(
        network,
        userId,
        organizationId,
        tx,
        { projectId },
      ),
    );
    if (balance < quotedCents) chargedCents = balance;
    if (chargedCents <= 0n) {
      return {
        outcome: "not_charged",
        transactionId: null,
        createdAt: null,
        quotedCents,
        chargedCents: 0n,
        shortfall: true,
        availableCents: balance,
      };
    }
  }

  let consumptions: Consumptions;
  try {
    consumptions = await inStage("preparation", () =>
      creditBucketRepository.prepareConsumption(
        network,
        userId,
        organizationId,
        chargedCents,
        tx,
        { projectId },
      ),
    );
  } catch (error) {
    // After a balance that covered the charge, credits that went since are
    // not an empty wallet: the error is thrown, with what was attempted
    // (`requested`) and what was left (`available`).
    if (
      !(error instanceof InsufficientBalanceError) ||
      mode === "up_to_balance"
    )
      throw error;
    // Not thrown: missing credits are an outcome here, not a failure.
    thrownInPreparation.delete(error);
    return {
      outcome: "not_charged",
      transactionId: null,
      createdAt: null,
      quotedCents,
      chargedCents: 0n,
      shortfall: true,
      availableCents: error.available,
    };
  }
  const { transactionId, createdAt } = await record(chargedCents, consumptions);
  return chargedCents < quotedCents
    ? {
        outcome: "partly_charged",
        transactionId,
        createdAt,
        quotedCents,
        chargedCents,
        shortfall: true,
      }
    : {
        outcome: "charged",
        transactionId,
        createdAt,
        quotedCents,
        chargedCents,
        shortfall: false,
      };
}

type Consumptions = Awaited<
  ReturnType<typeof creditBucketRepository.prepareConsumption>
>;
