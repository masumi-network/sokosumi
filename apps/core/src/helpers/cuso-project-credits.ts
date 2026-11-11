import type { Prisma } from "@sokosumi/database";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";

/**
 * Project credits end with the live Cuso (ADR 0067). Call it in the
 * transaction that archives or deletes the bot, before that write.
 * Any other bot leaves the Project's credits alone, so archiving another bot
 * of a CMO Project forfeits nothing.
 *
 * Writes off what is left: one spend per bucket for its remaining amount, the
 * way a leftover member period is drained, so the bucket's history stays
 * intact. Pool buckets and other Projects' buckets are untouched.
 */
export async function forfeitCusoProjectCredits(
  sokoBotId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const cuso = await tx.sokoBot.findFirst({
    where: { id: sokoBotId, ...LIVE_CUSO_WHERE },
    select: { projectId: true },
  });
  if (!cuso?.projectId) return;
  const projectId = cuso.projectId;

  const now = new Date();
  const buckets = await tx.$queryRaw<
    Array<{
      id: string;
      organizationId: string | null;
      userId: string | null;
      remaining: bigint;
    }>
  >`
    SELECT
      cb.id,
      cb."organizationId",
      cb."userId",
      (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE cb."projectId" = ${projectId}::uuid
      AND (cb."expiresAt" IS NULL OR cb."expiresAt" > ${now})
    GROUP BY cb.id, cb."organizationId", cb."userId", cb.amount
    HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
  `;
  // No note/type column on Transaction: a write-off reads as a plain spend.
  for (const bucket of buckets) {
    await tx.transaction.create({
      data: {
        amount: bucket.remaining * -1n,
        organizationId: bucket.organizationId,
        userId: bucket.userId,
        creditConsumptions: {
          create: { amount: bucket.remaining, bucketId: bucket.id },
        },
      },
    });
  }
}
