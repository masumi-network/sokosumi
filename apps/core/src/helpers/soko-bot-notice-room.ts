import type { Prisma } from "@sokosumi/database";
import { isPersonalSokoBot, isSharedSokoBot } from "@/helpers/soko-bot-kind";
import prisma, { type DbClient } from "@/lib/db/prisma";

/**
 * Where a Soko Bot speaks when nobody asked it in a conversation: its owner's
 * direct room for a personal bot, its shared room for a shared bot. A shared
 * bot has no owner and no direct rooms, so it never falls back to one.
 */
export interface SokoBotNoticeBot {
  id: string;
  userId: string | null;
  workspaceId: string;
  sharedRoomId: string | null;
  workspace: { organizationId: string | null };
}

export const SOKO_BOT_NOTICE_BOT_SELECT = {
  id: true,
  userId: true,
  workspaceId: true,
  sharedRoomId: true,
  workspace: { select: { organizationId: true } },
} as const satisfies Prisma.SokoBotSelect;

/** A room to post into, and the member the post should @mention. */
export interface SokoBotNoticeRoom {
  id: string;
  mentionUserId: string | null;
}

const SELF_STARTED_SOURCES = new Set(["SCHEDULE", "EVENT", "INGEST"]);

/**
 * The shared bot's own room. It follows the organization's members, so a
 * member joining or leaving never revokes output there.
 */
export function isOwnSharedRoom(
  bot: { userId: string | null; sharedRoomId: string | null },
  roomId: string,
): boolean {
  return isSharedSokoBot(bot) && bot.sharedRoomId === roomId;
}

/** A turn the bot started itself must have somewhere to speak. */
export function needsProactiveDestination(source: string): boolean {
  return SELF_STARTED_SOURCES.has(source);
}

/**
 * A shared bot's own room, while it is live and the bot is still in it, and
 * the member to @mention there. A member who left the room still has the bot
 * speak in it, without a mention: a mention only reaches room members.
 * `sharedRoomId` is null until the room exists, or after the room was
 * deleted; then there is nowhere to speak.
 */
export async function sharedSokoBotRoom(
  bot: { id: string; sharedRoomId: string | null },
  memberUserId: string | null,
  client: DbClient = prisma,
): Promise<SokoBotNoticeRoom | null> {
  if (bot.sharedRoomId === null) return null;
  const room = await client.chatRoom.findFirst({
    where: {
      id: bot.sharedRoomId,
      archivedAt: null,
      sokoBotMembers: { some: { sokoBotId: bot.id } },
    },
    select: { id: true },
  });
  if (!room) return null;
  const member =
    memberUserId === null
      ? null
      : await client.chatRoomUserMember.findUnique({
          where: { roomId_userId: { roomId: room.id, userId: memberUserId } },
          select: { userId: true },
        });
  return { id: room.id, mentionUserId: member?.userId ?? null };
}

/**
 * A proactive turn needs somewhere to speak. An owner who never opened the
 * bot's chat has nowhere, so every schedule, event and ingest dead-lettered
 * and the bot looked dead. The owner's own direct room is always authorized;
 * it is opened here. A room that exists but was archived stays suppressed.
 */
async function openFirstOwnerDirectRoom(
  sokoBotId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const anyDirect = await prisma.chatRoom.findFirst({
    where: {
      kind: "direct",
      sokoBotMembers: { some: { sokoBotId } },
      userMembers: { some: { userId } },
    },
    select: { id: true },
  });
  if (anyDirect) return null;
  const bot = await prisma.sokoBot.findFirst({
    where: { id: sokoBotId, userId, archivedAt: null },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!bot) return null;
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  return findOrOpenOwnerDirectRoom(bot, userId);
}

// An operator retry of one failed turn: `admin-retry:<turnId>:<operation>`.
const FAILED_TURN_RETRY_KEY = /^admin-retry:([^:]+):/;

/**
 * Where a shared bot's operator retry speaks: where the turn it replays
 * spoke. A schedule run retry replays a rhythm, which speaks in the shared
 * room. A retried turn from another room (a private channel, say) must not
 * land in the shared room, which every member reads, so it is refused; one
 * that had no room keeps none.
 */
async function sharedRetryRoom(
  bot: { id: string; sharedRoomId: string | null },
  turn: { userId: string | null; clientTurnId: string },
): Promise<SokoBotNoticeRoom | null> {
  const failedTurnId = turn.clientTurnId.match(FAILED_TURN_RETRY_KEY)?.[1];
  if (failedTurnId === undefined) return sharedSokoBotRoom(bot, turn.userId);
  const failed = await prisma.sokoBotTurn.findFirst({
    where: { id: failedTurnId, sokoBotId: bot.id },
    select: { destinationRoomId: true },
  });
  if (!failed || failed.destinationRoomId === null) return null;
  if (failed.destinationRoomId === bot.sharedRoomId)
    return sharedSokoBotRoom(bot, turn.userId);
  const { SokoBotValidationError } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  throw new SokoBotValidationError(
    "This turn spoke outside the shared Soko Bot's room, so it cannot be retried",
  );
}

/**
 * Where a turn started outside a conversation speaks. A personal bot uses
 * the member's live direct room with it, opened for a self-started turn when
 * none ever existed. A shared bot speaks only in its shared room, for a
 * self-started turn or an operator retry of one: a console turn has no room.
 */
export async function turnDestinationRoom(
  bot: { id: string; userId: string | null; sharedRoomId: string | null },
  /** `userId` is null when a shared bot acts on its own. */
  turn: { userId: string | null; clientTurnId: string },
  source: string,
): Promise<{ id: string } | null> {
  const memberUserId = turn.userId;
  if (isSharedSokoBot(bot)) {
    const room = needsProactiveDestination(source)
      ? await sharedSokoBotRoom(bot, memberUserId)
      : source === "ADMIN_RETRY"
        ? await sharedRetryRoom(bot, turn)
        : null;
    return room ? { id: room.id } : null;
  }
  // A personal bot always acts for its owner.
  if (memberUserId === null) return null;
  return (
    (await prisma.chatRoom.findFirst({
      // Rooms carry no workspace; the bot's membership scopes this to
      // the workspace the bot lives in (one bot per user and workspace).
      where: {
        kind: "direct",
        archivedAt: null,
        sokoBotMembers: { some: { sokoBotId: bot.id } },
        userMembers: { some: { userId: memberUserId } },
      },
      select: { id: true },
    })) ??
    (needsProactiveDestination(source)
      ? await openFirstOwnerDirectRoom(bot.id, memberUserId)
      : null)
  );
}

/**
 * Where a notice outside any turn goes. A personal bot's owner gets their
 * direct room, opened if needed. A shared bot posts in its shared room and
 * names the member it concerns; without a live room it posts nothing.
 */
export async function resolveNoticeRoom(
  bot: SokoBotNoticeBot,
  mentionUserId: string | null,
): Promise<SokoBotNoticeRoom | null> {
  if (!isPersonalSokoBot(bot)) {
    return sharedSokoBotRoom(bot, mentionUserId);
  }
  const { findOrOpenOwnerDirectRoom } = await import(
    "@/services/soko-bot-chat.service"
  );
  const room = await findOrOpenOwnerDirectRoom(bot, bot.userId);
  return { id: room.id, mentionUserId: null };
}

/** Prefixes the member's mention token, the form chat resolves to a person. */
export function withNoticeMention(
  content: string,
  mentionUserId: string | null,
): string {
  return mentionUserId === null ? content : `@${mentionUserId} ${content}`;
}
