import type { Prisma } from "@sokosumi/database";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";

import type { NetworkScope } from "@/lib/db/network-scope";

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

export interface SpendInput {
  /** The Network whose credits pay. The one place the Network is read. */
  scope: NetworkScope;
  /**
   * The caller's open transaction: the debit commits or rolls back with the
   * caller's own receipt, at the caller's isolation level and retry rules.
   */
  tx: Prisma.TransactionClient;
  payer: CreditPayer;
  /** The price, in cents, above zero. */
  quotedCents: bigint;
}

export type SpendResult =
  | {
      /** The debit: the credit transaction written. */
      transactionId: string;
      quotedCents: bigint;
      chargedCents: bigint;
      shortfall: false;
    }
  | {
      /** The credits do not cover the price: nothing was written. */
      transactionId: null;
      quotedCents: bigint;
      chargedCents: 0n;
      shortfall: true;
      /** What the payer's credits could cover. */
      availableCents: bigint;
    };

/**
 * Spends the payer's credits for a price, in full or not at all: the soonest
 * expiring credits first, a Project's own before the pool. The module owns
 * which credits pay and the rows of the debit. The caller owns who may spend,
 * the price, the transaction and its retries, and its own receipt, which is
 * also how it knows a repeated call is already paid.
 */
export async function spend(input: SpendInput): Promise<SpendResult> {
  const { scope, tx, payer, quotedCents } = input;
  let consumptions: Awaited<
    ReturnType<typeof creditBucketRepository.prepareConsumption>
  >;
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      scope.network,
      payer.userId,
      payer.organizationId,
      quotedCents,
      tx,
      { projectId: payer.projectId },
    );
  } catch (error) {
    if (!(error instanceof InsufficientBalanceError)) throw error;
    return {
      transactionId: null,
      quotedCents,
      chargedCents: 0n,
      shortfall: true,
      availableCents: error.available,
    };
  }
  const transaction = await tx.transaction.create({
    data: {
      amount: -quotedCents,
      userId: payer.userId,
      organizationId: payer.organizationId,
      creditConsumptions: { createMany: { data: consumptions } },
    },
    select: { id: true },
  });
  return {
    transactionId: transaction.id,
    quotedCents,
    chargedCents: quotedCents,
    shortfall: false,
  };
}
