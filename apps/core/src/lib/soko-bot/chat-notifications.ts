import { waitUntil } from "@vercel/functions";

import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import prisma from "@/lib/db/prisma";

interface SokoBotNotificationRoom {
  id: string;
  name: string;
  kind: string;
  organizationId: string | null;
  authorName: string;
}

export async function scheduleSokoBotChatNotifications(
  room: SokoBotNotificationRoom,
  messageId: string,
  content: string,
): Promise<void> {
  if (room.kind !== "direct") {
    return;
  }

  const memberUserIds = (
    await prisma.chatRoomUserMember.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    })
  ).map((member) => member.userId);

  if (
    shouldEmitChatDirectMessageNotifications({ kind: room.kind, memberUserIds })
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
}
