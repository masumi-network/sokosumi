import type { Prisma } from "@sokosumi/database";

import { failOpenChatRoomMentions } from "@/helpers/chat-room-mention-status";

/**
 * Closing a Project archives its Soko Bots in the close transaction, the same
 * way an archive does: running turns are asked to cancel, the bot pauses and
 * leaves its rooms, and open mentions fail. Its shared room turns read-only
 * through the archived bot. No reopen path restores them; a bot comes back only
 * when someone reactivates it. Personal bots never have a `projectId`.
 *
 * Returns the mention messages to republish after the transaction commits.
 */
export async function archiveProjectSokoBotsForClose(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<string[]> {
  // Same row lock as an archive or a deletion, so neither runs past the close.
  const bots = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "soko_bot"
    WHERE "projectId" = ${projectId}::uuid
      AND "archivedAt" IS NULL
      AND "deletedAt" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  if (bots.length === 0) return [];
  const sokoBotIds = bots.map((bot) => bot.id);
  const archivedAt = new Date();

  await tx.sokoBotTurn.updateMany({
    where: {
      sokoBotId: { in: sokoBotIds },
      status: { in: ["STARTING", "RUNNING"] },
    },
    data: { status: "CANCEL_REQUESTED", cancellationRequestedAt: archivedAt },
  });
  await tx.sokoBot.updateMany({
    where: { id: { in: sokoBotIds } },
    data: { archivedAt, status: "PAUSED", eveSessionId: null },
  });
  const mentionMessageIds = await failOpenChatRoomMentions(
    {
      where: { sokoBotId: { in: sokoBotIds } },
      error: "This Soko Bot was archived when its project closed",
    },
    tx,
  );
  await tx.chatRoomSokoBotMember.deleteMany({
    where: { sokoBotId: { in: sokoBotIds } },
  });
  return mentionMessageIds;
}
