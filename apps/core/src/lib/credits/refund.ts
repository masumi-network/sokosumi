import type { Prisma } from "@sokosumi/database";

import {
  type CompensatingRefundInput,
  createCompensatingRefund,
} from "@/helpers/compensating-refund";
import type { MainnetScope } from "@/lib/db/network-scope";

/** What a refund reads of the charge, with `COMPENSATED_SPEND_CONSUMPTIONS_SELECT`. */
export { COMPENSATED_SPEND_CONSUMPTIONS_SELECT } from "@/helpers/compensating-refund";

/** The debit a refund gives back, as the caller read it in its transaction. */
export interface RefundedCharge {
  /** Negative cents, as the debit stores them. */
  amount: bigint;
  userId: string | null;
  organizationId: string | null;
  creditConsumptions: CompensatingRefundInput["consumptions"];
}

export interface RefundInput {
  /**
   * The Network whose credits are given back. Mainnet's only: the refund
   * still writes through the caller's legacy transaction, which reaches this
   * deployment's own ledger. Ticket 27 takes any scope and branches on it.
   */
  scope: MainnetScope;
  /**
   * The caller's open transaction: the refund commits or rolls back with the
   * caller's guard and its link to the refund, at the caller's isolation.
   */
  tx: Prisma.TransactionClient;
  /**
   * The charge, read by the caller in `tx` together with its own guard, so
   * the refund adds no read of its own.
   */
  charge: RefundedCharge;
  /**
   * The refund's identity: its bucket's referenceId, unique with the REFUND
   * type, which also refuses a second refund of the same record.
   */
  referenceId: string;
  /** Names the record in the error for a charge with no member, e.g. `Task payment claim <id>`. */
  record?: string;
}

/**
 * Gives a charge back to the credits it took: each Project's part to that
 * Project, the rest to the pool, in non-expiring buckets
 * (`createCompensatingRefund`). Returns the id of the refund transaction the
 * caller links to its record. The caller owns when a refund is due, its
 * guard against a second one, the link and any audit row.
 */
export async function refund(input: RefundInput): Promise<string> {
  const { tx, charge, referenceId, record } = input;
  const actorUserId = charge.userId;
  if (actorUserId === null) {
    throw new Error(
      record
        ? `${record} spend transaction is missing userId`
        : "Spend transaction is missing userId",
    );
  }
  return await createCompensatingRefund(tx, {
    amount: charge.amount * -1n,
    actorUserId,
    organizationId: charge.organizationId,
    referenceId,
    consumptions: charge.creditConsumptions,
  });
}
