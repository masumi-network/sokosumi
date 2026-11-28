import type { Prisma } from "@sokosumi/database";

import {
  type CompensatingRefundInput,
  createCompensatingRefund,
} from "@/helpers/compensating-refund";
import type { MainnetScope, NetworkScope } from "@/lib/db/network-scope";
import { chargesCredits } from "./policy";

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
   * The Network of the charge. On Mainnet the refund writes through the
   * caller's legacy transaction, which reaches this deployment's own ledger.
   * On a Network that charges no credits (Preprod) nothing was taken, so
   * nothing is given back.
   */
  scope: NetworkScope;
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
 *
 * On a Network that charges no credits it writes nothing and returns null:
 * the payment closes with its quoted price and no credit refund row (the
 * user, 2026-11-27, decision 2). A caller that wants a different record
 * for such a payment (an audit note) writes it on null itself.
 */
export async function refund(
  input: RefundInput & { scope: MainnetScope },
): Promise<string>;
export async function refund(input: RefundInput): Promise<string | null>;
export async function refund(input: RefundInput): Promise<string | null> {
  const { tx, charge, referenceId, record } = input;
  // A refusing scope throws here, before anything is written.
  if (!chargesCredits(input.scope.network)) return null;
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
