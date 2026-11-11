import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

interface SokoBotLiveness {
  userId: string | null;
  projectId: string | null;
  versionId: string | null;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
}

/** `LIVE_CUSO_WHERE` (cmo-cuso.service) read on a row already in hand. */
function isLiveCuso(
  bot: SokoBotLiveness,
): bot is SokoBotLiveness & { projectId: string } {
  return (
    bot.userId === null &&
    bot.projectId != null &&
    bot.versionId !== null &&
    CMO_SOKO_BOT_VERSION_IDS.includes(bot.versionId) &&
    bot.archivedAt == null &&
    bot.deletedAt == null
  );
}

/**
 * Project credits end with the live Cuso (ADR 0067). Call it in the
 * transaction that archives or deletes `bot`, with the row as it was before.
 * Any other bot leaves the Project's credits alone, so archiving another bot
 * of a CMO Project forfeits nothing.
 */
export async function forfeitCusoProjectCredits(
  bot: SokoBotLiveness,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (!isLiveCuso(bot)) return;
  await creditBucketRepository.writeOffProjectCredits(bot.projectId, tx);
}
