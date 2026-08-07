import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";

import type { ChatRoomMessageEventType } from "@sokosumi/utils";

import {
  type ChatRoomMessageEventPatch,
  type ChatRoomMessagePatchEventType,
  publishChatRoomMessageEvent,
} from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
} from "@/routes/v1/chats/rooms/helpers";
import {
  type ChatRoomMessage,
  chatRoomMessageSchema,
} from "@/schemas/chat-room.schema";

type ChatRoomMessageWithInclude = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

const PATCH_EVENT_TYPES = new Set<ChatRoomMessageEventType>([
  "reaction",
  "unfurl",
  "mention_status",
]);

function isPatchEventType(
  eventType: ChatRoomMessageEventType,
): eventType is ChatRoomMessagePatchEventType {
  return PATCH_EVENT_TYPES.has(eventType);
}

function buildChatRoomMessagePatch(
  eventType: ChatRoomMessagePatchEventType,
  dto: ChatRoomMessage,
): ChatRoomMessageEventPatch {
  switch (eventType) {
    case "reaction":
      return { reactions: dto.reactions };
    case "unfurl":
      return { unfurls: dto.unfurls };
    case "mention_status":
      return { mentions: dto.mentions };
  }
}

/**
 * Publish one viewer-neutral chat_room_message event on the room channel.
 * Membership isolation is enforced by Ably token capabilities (SOK-741).
 */
export async function publishChatRoomMessageRealtime(
  message: ChatRoomMessageWithInclude,
  eventType: ChatRoomMessageEventType,
): Promise<void> {
  try {
    // No currentUserId: shared wire DTO; clients derive viewer flags.
    const dto = chatRoomMessageSchema.parse(mapChatRoomMessage(message));
    if (isPatchEventType(eventType)) {
      await publishChatRoomMessageEvent({
        eventType,
        messageId: dto.id,
        roomId: dto.roomId,
        parentMessageId: dto.parentMessageId,
        patch: buildChatRoomMessagePatch(eventType, dto),
      });
      return;
    }
    await publishChatRoomMessageEvent({
      eventType,
      message: dto,
    });
  } catch (error) {
    console.error("Failed to publish chat room message over Ably:", error);
    Sentry.captureException(error, {
      extra: {
        messageId: message.id,
        roomId: message.roomId,
        errorType: "ably-publish-chat-room-message",
      },
    });
  }
}

export async function publishChatRoomMessageRealtimeById(
  messageId: string,
  eventType: ChatRoomMessageEventType,
): Promise<void> {
  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      include: chatRoomMessageInclude,
    });
    if (!message) {
      return;
    }
    await publishChatRoomMessageRealtime(message, eventType);
  } catch (error) {
    console.error("Failed to load chat room message for Ably publish:", error);
    Sentry.captureException(error, {
      extra: {
        messageId,
        errorType: "ably-publish-chat-room-message-by-id",
      },
    });
  }
}
