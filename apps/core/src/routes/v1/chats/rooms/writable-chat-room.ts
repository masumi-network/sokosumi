import type { Prisma } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import { isRetiredSharedSokoBotRoom } from "@/helpers/shared-soko-bot-room";
import type prisma from "@/lib/db/prisma";

import { requireChatRoomUserWriteAccess } from "./helpers";
import { isReadOnlyDirectRoom } from "./read-only-room";

/**
 * Write access for adding to a room: a message, an upload, a Reaction. On top
 * of {@link requireChatRoomUserWriteAccess}, a Read-only Direct refuses them,
 * since nobody else is left to read them, and so does the room of an archived
 * or deleted shared Soko Bot. Edits to one's own messages go through the plain
 * write access and stay allowed.
 */
export async function requireWritableChatRoom(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma,
) {
  const room = await requireChatRoomUserWriteAccess(roomId, userId, tx);
  if (isReadOnlyDirectRoom(room)) {
    throw forbidden("Everyone else has left this Direct, so it is read-only.");
  }
  if (isRetiredSharedSokoBotRoom(room)) {
    throw forbidden(
      "This room's Soko Bot was archived, so the room is read-only.",
    );
  }
  return room;
}
