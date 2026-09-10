import { waitUntil } from "@vercel/functions";
import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";
import prisma from "@/lib/db/prisma";

interface SokoBotMessageRoom {
  id: string;
  name: string;
  kind: string;
  organizationId: string | null;
  authorName: string;
}

export async function scheduleSokoBotChatMessageEffects(
  room: SokoBotMessageRoom,
  messageId: string,
  content: string,
): Promise<void> {
  try {
    const memberUserIds = (
      await prisma.chatRoomUserMember.findMany({
        where: { roomId: room.id },
        select: { userId: true },
      })
    ).map((member) => member.userId);

    await invalidateChatRoomMessageReaders({
      roomId: room.id,
      authorUserId: null,
      memberUserIds,
    });

    if (
      shouldEmitChatDirectMessageNotifications({
        kind: room.kind,
        memberUserIds,
      })
    ) {
      waitUntil(
        emitChatDirectMessageNotifications({
          roomId: room.id,
          roomName: room.name,
          organizationId: room.organizationId,
          messageId,
          content,
          authorUserId: null,
          authorName: room.authorName,
          recipientUserIds: memberUserIds,
        }),
      );
    }
  } catch (error) {
    console.error("Failed to emit Soko Bot chat message effects", error);
  }
}
