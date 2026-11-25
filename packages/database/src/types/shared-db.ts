import type { Prisma } from "../generated/prisma/client.js";
import type { NetworkModelName } from "../sql-table-names.js";

/**
 * The shared side of a client or an open transaction: every model but the
 * Network ones, and raw SQL. The same shape as Core's `SharedDb`, so a
 * transaction from a Network scope and a legacy one are both accepted.
 */
export type SharedDb = Omit<
  Prisma.TransactionClient,
  Uncapitalize<NetworkModelName> | "$transaction"
>;
