import { waitUntil } from "@vercel/functions";
import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import { emitChatHumanMentionNotifications } from "@/helpers/chat-human-mentions";
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
  /** The members this message named, who are sent a mention of their own. */
  mentionedUserIds: readonly string[],
): Promise<void> {
  // Scheduled first: the mention rows are already committed, and this needs
  // nothing from the roster read below, so a failed read must not drop it.
  if (mentionedUserIds.length > 0) {
    waitUntil(
      emitChatHumanMentionNotifications({ messageId, mentionedUserIds }),
    );
  }

  try {
    const memberUserIds = (
      await prisma.chatRoomUserMember.findMany({
        where: { roomId: room.id },
        select: { userId: true },
      })
    ).map((member) => member.userId);

    await invalidateChatRoomMessageReaders({
      roomId: room.id,
      memberUserIds,
    });

    if (
      shouldEmitChatDirectMessageNotifications({
        kind: room.kind,
        memberUserIds,
      })
    ) {
      const mentionedUserIdSet = new Set(mentionedUserIds);
      const recipientUserIds = memberUserIds.filter(
        (userId) => !mentionedUserIdSet.has(userId),
      );
      if (recipientUserIds.length > 0) {
        waitUntil(
          emitChatDirectMessageNotifications({
            roomId: room.id,
            roomName: room.name,
            organizationId: room.organizationId,
            messageId,
            content,
            authorUserId: null,
            authorName: room.authorName,
            recipientUserIds,
          }),
        );
      }
    }
  } catch (error) {
    console.error("Failed to emit Soko Bot chat message effects", error);
  }
}
