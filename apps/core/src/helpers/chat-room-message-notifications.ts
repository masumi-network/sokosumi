import type { NotificationCategory } from "@sokosumi/utils";
import {
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  resolveNotificationDelivery,
} from "@/helpers/notification-delivery";
import prisma from "@/lib/db/prisma";

import { shouldEmitChatDirectMessageNotifications } from "./chat-direct-message-notifications";
import { fanOutChatNotifications } from "./chat-notification-fanout";

/** A reader, with everything the delivery decision needs. */
interface Reader {
  id: string;
  pushOptIn: boolean;
  notificationPreferences: {
    category: string;
    channel: string;
    enabled: boolean;
  }[];
}

/** Whether a notification of this category would reach the reader at all. */
function arrives(reader: Reader, category: NotificationCategory): boolean {
  const delivery = resolveNotificationDelivery({
    category,
    preferences: reader.notificationPreferences,
    pushOptIn: reader.pushOptIn,
  });

  return delivery.inApp || delivery.osBanner;
}

export interface EmitChatRoomMessageNotificationsParams {
  roomId: string;
  roomName: string;
  /** Decides whether the direct-message row already covers this room. */
  roomKind: string;
  organizationId: string | null;
  messageId: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  /** The room's humans, when the caller already read them. */
  memberUserIds?: readonly string[];
  /** The members this message named, who were sent a mention of their own. */
  mentionedUserIds?: readonly string[];
}

/**
 * Emit CHAT notifications for every message in a room, for the members who
 * asked for them. Schedule via waitUntil.
 *
 * Three questions decide who hears about a message, and all three are asked
 * before anything is written:
 *
 * A direct room the direct-message row already covers is left alone, so one
 * message never arrives twice. That row stops at two humans
 * (`shouldEmitChatDirectMessageNotifications`), so a direct room with more
 * than two is a room like any other here rather than a room nobody hears from.
 *
 * A member who was named in the message is skipped only when the mention
 * actually reaches them. A reader who silenced mentions and asked for every
 * message would otherwise hear about every message in the room except the one
 * addressed to them.
 *
 * The rest are kept only when this category would reach them, asked through
 * the same `resolveNotificationDelivery` that decides delivery at write time.
 * A gate that asked a looser question would write a notification row per member
 * per message that no surface ever shows.
 */
export async function emitChatRoomMessageNotifications(
  params: EmitChatRoomMessageNotificationsParams,
): Promise<void> {
  const memberUserIds =
    params.memberUserIds ??
    (
      await prisma.chatRoomUserMember.findMany({
        where: { roomId: params.roomId },
        select: { userId: true },
      })
    ).map((member) => member.userId);

  if (
    shouldEmitChatDirectMessageNotifications({
      kind: params.roomKind,
      memberUserIds,
    })
  ) {
    return;
  }

  const candidateUserIds = [
    ...new Set(
      memberUserIds.filter((userId) => userId !== params.authorUserId),
    ),
  ];

  if (candidateUserIds.length === 0) {
    return;
  }

  const readers: Reader[] = await prisma.user.findMany({
    where: { id: { in: candidateUserIds } },
    select: {
      id: true,
      pushOptIn: true,
      notificationPreferences: {
        select: { category: true, channel: true, enabled: true },
      },
    },
  });
  const mentioned = new Set(params.mentionedUserIds ?? []);
  const recipientUserIds = readers
    .filter(
      (reader) =>
        arrives(reader, "CHAT_ROOM_MESSAGE") &&
        !(mentioned.has(reader.id) && arrives(reader, "CHAT_MENTION")),
    )
    .map((reader) => reader.id);

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
