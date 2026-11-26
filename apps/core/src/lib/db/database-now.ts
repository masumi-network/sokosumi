import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * PostgreSQL's clock, so times one host writes and another compares share a
 * clock. `clock_timestamp()`, not `now()`: inside a transaction `now()` is
 * the transaction's start, already old after a lock wait.
 * Return a UTC timestamp without an offset because Prisma drops the session offset.
 */
export async function databaseNow(
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
): Promise<Date> {
  const [{ now }] = await client.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  return now;
}
