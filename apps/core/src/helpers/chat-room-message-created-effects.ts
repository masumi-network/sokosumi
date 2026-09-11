import {
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  type NotificationCategory,
} from "@sokosumi/utils";
import { resolveNotificationDelivery } from "@/helpers/notification-delivery";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
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

export interface ChatRoomMessageCreatedEffectsParams {
  roomId: string;
  roomName: string;
  /** Decides whether the direct-message row already covers this room. */
  roomKind: string;
  organizationId: string | null;
  messageId: string;
  content: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  /** The room's humans, when the caller already read them. */
  memberUserIds?: readonly string[];
  /** The members this message named, who were sent a mention of their own. */
  mentionedUserIds?: readonly string[];
}

/**
 * Invalidate reader collections and emit opted-in CHAT notifications after a
 * committed message creation. Schedule via waitUntil. Notification failures
 * cannot suppress unread invalidations.
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
export async function emitChatRoomMessageCreatedEffects(
  params: ChatRoomMessageCreatedEffectsParams,
): Promise<void> {
  const memberUserIds = await getMemberUserIds(params);
  const results = await Promise.allSettled([
    invalidateChatRoomMessageReaders({ roomId: params.roomId, memberUserIds }),
    emitChatRoomMessageNotifications(params, memberUserIds),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to emit chat room message effects", result.reason);
    }
  }
}

interface ChatRoomMessageReaders {
  roomId: string;
  memberUserIds?: readonly string[];
  excludedUserIds?: readonly string[];
}

async function getMemberUserIds(
  params: ChatRoomMessageReaders,
): Promise<readonly string[]> {
  return (
    params.memberUserIds ??
    (
      await prisma.chatRoomUserMember.findMany({
        where: { roomId: params.roomId },
        select: { userId: true },
      })
    ).map((member) => member.userId)
  );
}

/** After commit: refresh every member, including the author’s other tabs. */
export async function invalidateChatRoomMessageReaders(
  params: ChatRoomMessageReaders,
): Promise<void> {
  try {
    const memberUserIds = await getMemberUserIds(params);
    const userIds = [...new Set(memberUserIds)];
    if (userIds.length === 0) return;
    const recipients = userIds.filter(
      (userId) => !params.excludedUserIds?.includes(userId),
    );
    if (recipients.length === 0) return;
    await publishChatRoomsChanged({
      userIds: recipients,
      collections: ["active"],
      roomId: params.roomId,
    });
  } catch (error) {
    console.error("Failed to invalidate chat room message readers", error);
  }
}

async function emitChatRoomMessageNotifications(
  params: ChatRoomMessageCreatedEffectsParams,
  memberUserIds: readonly string[],
): Promise<void> {
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
    roomKind: params.roomKind,
    organizationId: params.organizationId,
    messageId: params.messageId,
    content: params.content,
    authorUserId: params.authorUserId,
    authorName: params.authorName,
    recipientUserIds,
    messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
    notificationType: "chat-room-message-notification",
    // A mention and a direct message are each about themselves. This one is
    // about the room, so the reader gets one row for it and a count.
    countPerRoom: true,
    // Only a direct room with three or more people reaches this line: the
    // one-to-one rooms returned above. Its name is the list of who is in it.
    isGroup: params.roomKind === "direct",
  });
}
