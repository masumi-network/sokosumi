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

export async function publishChatRoomMessageRealtime(
  message: ChatRoomMessageWithInclude,
  eventType: ChatRoomMessageEventType,
): Promise<void> {
  try {
    const members = await prisma.chatRoomUserMember.findMany({
      where: { roomId: message.roomId },
      select: { userId: true },
    });

    // Per-member isolation: one map/parse/publish failure must not cancel
    // fan-out to the rest of the room (Promise.all would fail-fast).
    const results = await Promise.allSettled(
      members.map(async ({ userId }) => {
        const dto = chatRoomMessageSchema.parse(
          mapChatRoomMessage(message, userId),
        );
        if (isPatchEventType(eventType)) {
          await publishChatRoomMessageEvent({
            userId,
            eventType,
            messageId: dto.id,
            roomId: dto.roomId,
            parentMessageId: dto.parentMessageId,
            patch: buildChatRoomMessagePatch(eventType, dto),
          });
          return;
        }
        await publishChatRoomMessageEvent({
          userId,
          eventType,
          message: dto,
        });
      }),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        continue;
      }
      const userId = members[index]?.userId;
      console.error(
        "Failed to publish chat room message over Ably for member:",
        userId,
        result.reason,
      );
      Sentry.captureException(result.reason, {
        extra: {
          messageId: message.id,
          roomId: message.roomId,
          userId,
          errorType: "ably-publish-chat-room-message",
        },
      });
    }
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
