import type { Prisma } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
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
  await writeOffProjectCredits(cuso.projectId, tx);
}

/**
 * A version change that takes Cuso off CMO ends him, so it forfeits his
 * Project credits; a move between CMO versions keeps them. Call it before
 * the version write, like `forfeitCusoProjectCredits`.
 */
export async function forfeitCusoProjectCreditsIfLeavingCmo(
  sokoBotId: string,
  versionId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (CMO_SOKO_BOT_VERSION_IDS.includes(versionId)) return;
  await forfeitCusoProjectCredits(sokoBotId, tx);
}

/**
 * For a refund that lands in a Project: writes its credits off unless the
 * Project still has a live Cuso.
 *
 * The check is a write to Cuso's row, not a read, so it serializes with
 * `forfeitCusoProjectCredits`. Callers run Read Committed: if an archive or
 * version change commits first, the UPDATE rechecks its WHERE on the new row
 * and matches nothing. If the refund commits first, the Serializable archive
 * fails on the row it then writes and retries on a snapshot with the refund.
 * A FOR UPDATE alone would let that archive go on with its stale snapshot.
 */
export async function writeOffUnlessLiveCuso(
  projectId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { count } = await tx.sokoBot.updateMany({
    where: { ...LIVE_CUSO_WHERE, projectId },
    data: { updatedAt: new Date() },
  });
  if (count === 0) await writeOffProjectCredits(projectId, tx);
}

/**
 * Writes off what is left of one Project's credits. Also used for a refund
 * that lands after the Project lost its live Cuso, and for a version change
 * that takes Cuso off CMO.
 */
export async function writeOffProjectCredits(
  projectId: string,
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
