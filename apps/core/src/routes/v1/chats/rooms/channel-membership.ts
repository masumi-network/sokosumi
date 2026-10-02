import type { Prisma } from "@sokosumi/database";

import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "@/helpers/chat-room-mention-status";
import { publishChatRoomMembershipStatusMessagesBestEffort } from "@/helpers/chat-room-message-realtime";
import { badRequest, forbidden } from "@/helpers/error";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import { publishChatMembershipRevokedToUsers } from "@/lib/ably/publish";

import { type ChatRoomWithMembers, requireChatRoomUserAccess } from "./helpers";
import type {
  ChannelMembershipChange,
  ChannelMembershipStatusMessage,
  MembershipActor,
} from "./membership-status";

export const ASSISTANT_GONE =
  "Personal assistant is no longer a member of this room";

/**
 * The caller may add or remove members of this room: it is an organization
 * Channel, not a matched one (admins run those), and the caller is a host
 * member rather than a Guest. Who may remove *whom* is decided per target.
 */
export async function requireChannelRosterAccess(
  tx: Prisma.TransactionClient,
  roomId: string,
  userId: string,
  addedUserIds: readonly string[] = [],
): Promise<{
  room: ChatRoomWithMembers;
  organizationId: string;
  actor: MembershipActor;
}> {
  // Organization removal locks Member before room membership. Follow that
  // order, and keep actor role and new targets eligible until commit. Room
  // locking alone cannot fence a target not yet on the room's roster.
  const userIds = [...new Set([userId, ...addedUserIds])];
  await tx.$queryRaw`
    SELECT "member"."id"
    FROM "member"
    JOIN "chat_room" ON "chat_room"."organizationId" = "member"."organizationId"
    WHERE "chat_room"."id" = ${roomId}::uuid
      AND "member"."userId" = ANY(${userIds}::text[])
    ORDER BY "member"."id"
    FOR SHARE OF "member"
  `;
  // Share the room lock with leave, archive, and guest invitation flows.
  // Read membership and permissions only after a concurrent writer commits.
  await tx.$queryRaw`
    SELECT "id" FROM "chat_room"
    WHERE "id" = ${roomId}::uuid
    FOR UPDATE
  `;
  const room = await requireChatRoomUserAccess(roomId, userId, tx);
  if (room.kind !== "channel") {
    throw badRequest("Only channel members can be managed.");
  }
  if (!room.organizationId || room.discoverability === "matched") {
    throw badRequest("Matched channel members are managed by Sokosumi.");
  }
  const caller = room.userMembers.find((member) => member.userId === userId);
  if (caller?.access === "guest") {
    throw forbidden("Guests cannot manage channel members.");
  }
  return {
    room,
    organizationId: room.organizationId,
    actor: { id: userId, name: caller?.user.name.trim() || "Someone" },
  };
}

/**
 * A Soko Bot goes with its owner: left behind in a Channel it would stay
 * mentionable by everyone, answering for someone who is no longer there and
 * spending their credits. The removal carries `actor` when someone else
 * removed the owner, so the room says who did it.
 */
export async function removeOwnedSokoBotsFromChannel(
  tx: Prisma.TransactionClient,
  room: ChatRoomWithMembers,
  ownerUserId: string,
  actor?: MembershipActor,
): Promise<{
  changes: ChannelMembershipChange[];
  mentionMessageIds: string[];
}> {
  const bots = room.sokoBotMembers
    .filter((member) => member.sokoBot.userId === ownerUserId)
    .map((member) => member.sokoBot);
  if (room.kind !== "channel" || bots.length === 0) {
    return { changes: [], mentionMessageIds: [] };
  }
  const botIds = bots.map((bot) => bot.id);
  const mentionMessageIds = await failOpenChatRoomMentions(
    {
      where: { sokoBotId: { in: botIds }, message: { roomId: room.id } },
      error: ASSISTANT_GONE,
    },
    tx,
  );
  await tx.chatRoomSokoBotMember.deleteMany({
    where: { roomId: room.id, sokoBotId: { in: botIds } },
  });
  return {
    changes: bots.map((bot) => ({
      action: "left",
      subject: { type: "sokoBot", id: bot.id, name: sokoBotDisplayName(bot) },
      ...(actor ? { actor } : {}),
    })),
    mentionMessageIds,
  };
}

/**
 * After commit: the roster change is already durable, so the timeline, the
 * removed people's open tabs and stale mention chips are told independently;
 * one failing must not skip the others.
 */
export async function publishChannelMembershipEffects(args: {
  roomId: string;
  statusMessages: readonly ChannelMembershipStatusMessage[];
  removedUserIds?: readonly string[];
  mentionMessageIds?: readonly string[];
}): Promise<void> {
  const results = await Promise.allSettled([
    publishChatRoomMembershipStatusMessagesBestEffort(args.statusMessages),
    publishChatMembershipRevokedToUsers(
      args.roomId,
      args.removedUserIds ?? [],
      "removed",
    ),
    publishChatRoomMentionStatuses(args.mentionMessageIds ?? []),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "Failed to publish channel membership change",
        result.reason,
      );
    }
  }
}
