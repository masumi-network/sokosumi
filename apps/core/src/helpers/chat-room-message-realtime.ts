import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";

import { publishChatRoomMessageEvent } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
} from "@/routes/v1/chats/rooms/helpers";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

type ChatRoomMessageWithInclude = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

export async function publishChatRoomMessageRealtime(
  message: ChatRoomMessageWithInclude,
): Promise<void> {
  try {
    const members = await prisma.chatRoomUserMember.findMany({
      where: { roomId: message.roomId },
      select: { userId: true },
    });

    await Promise.all(
      members.map(async ({ userId }) => {
        const dto = chatRoomMessageSchema.parse(
          mapChatRoomMessage(message, userId),
        );
        await publishChatRoomMessageEvent({
          userId,
          message: dto,
        });
      }),
    );
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
): Promise<void> {
  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      include: chatRoomMessageInclude,
    });
    if (!message) {
      return;
    }
    await publishChatRoomMessageRealtime(message);
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
