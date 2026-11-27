import type { Prisma } from "../generated/prisma/client.js";
import type { NetworkModelName } from "../sql-table-names.js";

/**
 * The shared side of a client or an open transaction: every model but the
 * Network ones, and raw SQL. The one definition: Core's Network scope hands
 * it out under the same name. A legacy transaction is accepted too. No
 * `$transaction`, which Prisma 7 also leaves on a transaction client.
 */
export type SharedDb = Omit<
  Prisma.TransactionClient,
  Uncapitalize<NetworkModelName> | "$transaction"
>;
