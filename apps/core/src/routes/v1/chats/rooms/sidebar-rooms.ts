import { z } from "@hono/zod-openapi";
import prisma from "@/lib/db/prisma";
import { chatRoomSchema } from "@/schemas/chat-room.schema";
import { getChatRoomNeedsYouCounts } from "@/services/chat-signal-views.service";
import {
  type ChatRoomWithMembers,
  getChatRoomPinnedMessageCounts,
  getChatRoomSidebarFlags,
  getPeerInActiveOrganizationFlags,
  loadFormerDirectUserMembers,
  mapChatRoom,
} from "./helpers";
import { getChatRoomUnreadMentionCounts } from "./room-mention-counts";
import {
  getChatRoomUnreadCounts,
  listUnreadThreadsOfRoomsWithThreadUnread,
  unreadCountFields,
} from "./room-unread";

/**
 * Rooms as the sidebar's list receives them: each with what is unread in it,
 * the reader's marks and its Organization's name.
 */
export async function mapSidebarRooms(
  rooms: ChatRoomWithMembers[],
  userId: string,
  organizationId: string | null | undefined,
) {
  const roomIds = rooms.map((room) => room.id);
  const organizationIds = [
    ...new Set(
      rooms
        .map((room) => room.organizationId)
        .filter((id): id is string => id != null),
    ),
  ];
  // Started here so the unread Threads can wait on it alone, beside the
  // other reads rather than after them.
  const unreadCountsRead = getChatRoomUnreadCounts(roomIds, userId, prisma);
  const [
    unreadCounts,
    unreadThreads,
    unreadMentionCounts,
    needsYouCounts,
    sidebarFlags,
    pinnedMessageCounts,
    peerInActiveOrganizationFlags,
    formerUserMembers,
    organizations,
  ] = await Promise.all([
    unreadCountsRead,
    unreadCountsRead.then((counts) =>
      listUnreadThreadsOfRoomsWithThreadUnread(counts, userId, prisma),
    ),
    getChatRoomUnreadMentionCounts(roomIds, userId, prisma),
    getChatRoomNeedsYouCounts(roomIds, userId, prisma),
    getChatRoomSidebarFlags(roomIds, userId, prisma),
    getChatRoomPinnedMessageCounts(roomIds, prisma),
    getPeerInActiveOrganizationFlags(
      rooms,
      userId,
      organizationId ?? null,
      prisma,
    ),
    loadFormerDirectUserMembers(rooms, prisma),
    organizationIds.length > 0
      ? prisma.organization.findMany({
          where: { id: { in: organizationIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const organizationNameById = new Map(
    organizations.map((org) => [org.id, org.name]),
  );

  return z.array(chatRoomSchema).parse(
    rooms.map((room) => {
      const flags = sidebarFlags.get(room.id);
      return mapChatRoom(room, userId, {
        ...unreadCountFields(unreadCounts.get(room.id)),
        unreadThreads: unreadThreads.get(room.id),
        unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
        unreadNeedsYouCount: needsYouCounts.get(room.id) ?? 0,
        starredAt: flags?.starredAt ?? null,
        pinnedMessageCount: pinnedMessageCounts.get(room.id) ?? 0,
        mutedAt: flags?.mutedAt ?? null,
        markedUnread: flags?.markedUnread ?? false,
        organizationName: room.organizationId
          ? (organizationNameById.get(room.organizationId) ?? null)
          : null,
        peerInActiveOrganization:
          peerInActiveOrganizationFlags.get(room.id) ?? false,
        formerUserMembers: formerUserMembers.get(room.id),
      });
    }),
  );
}
