import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@/helpers/notification-delivery";
import prisma from "@/lib/db/prisma";

import { fanOutChatNotifications } from "./chat-notification-fanout";

export interface ShouldEmitChatRoomMessageNotificationsParams {
  kind: string;
}

/**
 * Direct rooms are excluded: their messages already have their own row, and a
 * reader who turned direct messages off should not receive the same message
 * again as a room message.
 */
export function shouldEmitChatRoomMessageNotifications(
  params: ShouldEmitChatRoomMessageNotificationsParams,
): boolean {
  return params.kind !== "direct";
}

/**
 * The members who asked to hear about every message in this room.
 *
 * `CHAT_ROOM_MESSAGE` is off until the reader turns it on
 * (`NOTIFICATION_CATEGORY_OFF_BY_DEFAULT`), so an absent row means no and a
 * stored row that is off means no. Asked as one query before anything is
 * written, because the alternative is a notification row per member per
 * message that nobody reads.
 */
async function readersWhoAskedForEveryMessage(
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }

  const optedIn = await prisma.notificationPreference.findMany({
    where: {
      userId: { in: [...userIds] },
      category: "CHAT_ROOM_MESSAGE",
      enabled: true,
    },
    select: { userId: true },
  });
  const optedInUserIds = new Set(
    optedIn.map((preference) => preference.userId),
  );

  return userIds.filter((userId) => optedInUserIds.has(userId));
}

export interface EmitChatRoomMessageNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  /**
   * Members already notified about this message, such as the ones it names.
   * The author is dropped here too, so nobody is asked about a preference for
   * a notification they were never going to receive.
   */
  excludeUserIds?: readonly string[];
}

/**
 * Emit CHAT notifications for every message in a room, for the members who
 * asked for them. Schedule via waitUntil.
 *
 * The members are read here rather than passed in, so a room that nobody
 * subscribed to costs the request nothing: both queries run inside the
 * scheduled work. The caller names the members it has already notified about
 * this message, so a mention arrives once rather than twice.
 */
export async function emitChatRoomMessageNotifications(
  params: EmitChatRoomMessageNotificationsParams,
): Promise<void> {
  const excluded = new Set([
    ...(params.excludeUserIds ?? []),
    ...(params.authorUserId === null ? [] : [params.authorUserId]),
  ]);
  const members = await prisma.chatRoomUserMember.findMany({
    where: { roomId: params.roomId },
    select: { userId: true },
  });
  const recipientUserIds = await readersWhoAskedForEveryMessage(
    members
      .map((member) => member.userId)
      .filter((userId) => !excluded.has(userId)),
  );

  if (recipientUserIds.length === 0) {
    return;
  }

  await fanOutChatNotifications({
    roomId: params.roomId,
    roomName: params.roomName,
    organizationId: params.organizationId,
    messageId: params.messageId,
    authorUserId: params.authorUserId,
    authorName: params.authorName,
    recipientUserIds,
    messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
    notificationType: "chat-room-message-notification",
  });
}
