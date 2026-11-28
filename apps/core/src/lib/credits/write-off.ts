import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { netTable } from "@sokosumi/database/sql-tables";
import { v7 as uuidv7 } from "uuid";

import type { MainnetScope } from "@/lib/db/network-scope";
import { requireChargingNetwork } from "./policy";

/**
 * Writes off what is left of credits that end before they are used: a
 * Project's when its live Cuso ends (ADR 0067), or the buckets a refunded
 * Polar order granted (ADR 0068). One spend per bucket for its remaining
 * amount, the way a leftover member period is drained, so the bucket's
 * history stays intact. A bucket that is spent or expired has nothing left
 * and gets no row, so a second call writes nothing. Other buckets, the pool's
 * and other Projects' included, are untouched.
 *
 * Runs in the caller's transaction, at its isolation: the caller owns when
 * credits end, and the write that serializes it with a grant (the Cuso's or
 * the Polar order's row).
 */
export async function writeOff(input: {
  /**
   * The Network whose credits are written off. Mainnet's only: the buckets
   * are read from Mainnet's tables and the spends written through the
   * caller's legacy transaction, as a refund's are.
   */
  scope: MainnetScope;
  tx: Prisma.TransactionClient;
  /** A Project's credits, or the given buckets. */
  of: { projectId: string } | { bucketIds: string[] };
}): Promise<void> {
  const { of, tx } = input;
  // A scope that refuses its Network throws here, before anything is written;
  // so does a fabricated Preprod one, which has no credits to write off.
  requireChargingNetwork(input.scope.network, "A credit write-off");
  if ("projectId" in of) {
    await writeOffCreditBuckets(
      PrismaRaw.sql`cb."projectId" = ${of.projectId}::uuid`,
      tx,
    );
    return;
  }
  if (of.bucketIds.length === 0) return;
  await writeOffCreditBuckets(
    PrismaRaw.sql`cb.id IN (${PrismaRaw.join(of.bucketIds)})`,
    tx,
  );
}

async function writeOffCreditBuckets(
  where: PrismaRaw.Sql,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const now = new Date();
  const buckets = await tx.$queryRaw<
    Array<{
      id: string;
      organizationId: string | null;
      userId: string | null;
      remaining: bigint;
    }>
  >(PrismaRaw.sql`
    SELECT
      cb.id,
      cb."organizationId",
      cb."userId",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM ${netTable("mainnet", "credit_bucket")} cb
    LEFT JOIN ${netTable("mainnet", "credit_consumption")} cc ON cc."bucketId" = cb.id
    WHERE ${where}
      AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
    GROUP BY cb.id, cb."organizationId", cb."userId", cb.amount
    HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
    ORDER BY cb."expiresAt" ASC NULLS LAST, cb."createdAt" ASC, cb.id ASC
  `);
  // No note/type column on Transaction: a write-off reads as a plain spend.
  for (const bucket of buckets) {
    const transactionId = uuidv7();
    const consumptionId = uuidv7();
    const writtenAt = new Date();
    await tx.$executeRaw`
      INSERT INTO ${netTable("mainnet", "Transaction")}
        (id, "createdAt", "updatedAt", amount, "userId", "organizationId")
      VALUES (
        ${transactionId},
        ${writtenAt},
        ${writtenAt},
        ${bucket.remaining * -1n},
        ${bucket.userId},
        ${bucket.organizationId}
      )
    `;
    await tx.$executeRaw`
      INSERT INTO ${netTable("mainnet", "credit_consumption")}
        (id, "createdAt", amount, "bucketId", "transactionId")
      VALUES (
        ${consumptionId},
        ${writtenAt},
        ${bucket.remaining},
        ${bucket.id},
        ${transactionId}
      )
    `;
  }
}
