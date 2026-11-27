import type { Prisma } from "../generated/prisma/client.js";
import type { NetworkModelName } from "../sql-table-names.js";

/**
 * The shared side of a client or an open transaction: every model but the
 * Network ones, and raw SQL. The one definition: Core's Network scope hands
 * it out under the same name. A legacy transaction is accepted too. No
 * `$transaction`, which Prisma 7 also leaves on a transaction client.
 */
/**
 * An open transaction of either side, for raw SQL only. Raw SQL names the
 * schema of every table, so the connection's side does not matter: the shared
 * side and a Network side both satisfy it, without a cast.
 */
export type RawSqlDb = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "$executeRaw"
>;

/**
 * The transaction a credit read or write runs on, with its side named: the
 * side decides how the shared plan and Seat rows are read. On the shared side
 * through models, as before; on a Network side in raw SQL on that same
 * connection, because a Network client's models name the Network's schema.
 */
export type CreditDb = { shared: SharedDb } | { network: RawSqlDb };

export type SharedDb = Omit<
  Prisma.TransactionClient,
  Uncapitalize<NetworkModelName> | "$transaction"
>;
