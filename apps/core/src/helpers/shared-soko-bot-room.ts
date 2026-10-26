import type { Prisma } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import type prisma from "@/lib/db/prisma";

/**
 * A shared Soko Bot's room lives as long as the bot row does: the member join
 * trigger only reaches an unarchived room, and guests are not team members.
 * Room changes that would break that are refused while any bot (live,
 * archived or tombstoned) names the room as its `sharedRoomId`.
 */
const SHARED_SOKO_BOT_ROOM_REFUSALS = {
  archive:
    "A shared Soko Bot's room cannot be archived. Archive the Soko Bot instead.",
  delete: "A shared Soko Bot's room cannot be permanently deleted.",
  external: "A shared Soko Bot's room cannot take guests.",
  private:
    "A shared Soko Bot's room stays public, because every member can read the bot's turns.",
} as const;

export type SharedSokoBotRoomChange =
  keyof typeof SHARED_SOKO_BOT_ROOM_REFUSALS;

export async function assertNotSharedSokoBotRoom(
  roomId: string,
  change: SharedSokoBotRoomChange,
  client: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  const bot = await client.sokoBot.findUnique({
    where: { sharedRoomId: roomId },
    select: { id: true },
  });
  if (bot) {
    throw badRequest(SHARED_SOKO_BOT_ROOM_REFUSALS[change]);
  }
}

/** Select on a room for {@link isRetiredSharedSokoBotRoom}. */
export const sharedSokoBotRoomStateSelect = {
  select: { archivedAt: true, deletedAt: true },
} as const;

/**
 * A live room that still takes new posts from a Coworker or a Soko Bot: not
 * archived, and not the room of an archived or deleted shared Soko Bot.
 */
export const writableAssistantRoomWhere: Prisma.ChatRoomWhereInput = {
  archivedAt: null,
  OR: [
    { sharedSokoBot: { is: null } },
    { sharedSokoBot: { is: { archivedAt: null, deletedAt: null } } },
  ],
};

/**
 * The room of an archived or deleted shared Soko Bot keeps its history but
 * takes nothing new. Unarchiving the bot makes it writable again.
 */
export function isRetiredSharedSokoBotRoom(room: {
  sharedSokoBot?: { archivedAt: Date | null; deletedAt: Date | null } | null;
}): boolean {
  const bot = room.sharedSokoBot;
  return bot != null && (bot.archivedAt !== null || bot.deletedAt !== null);
}
