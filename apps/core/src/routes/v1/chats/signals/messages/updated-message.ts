import { waitUntil } from "@vercel/functions";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { emitCoreError, runAsBackgroundWork } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  withChatRoomReplyCount,
} from "@/routes/v1/chats/rooms/helpers";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

/**
 * The message after a reader changed its signal, as the caller now sees it.
 * Every other member's copy refreshes too, and their room lists recount
 * what needs them.
 */
export async function answerWithUpdatedMessage(
  messageId: string,
  userId: string,
) {
  const message = await prisma.chatRoomMessage.findUniqueOrThrow({
    where: { id: messageId },
    include: chatRoomMessageInclude,
  });
  waitUntil(
    runAsBackgroundWork(async () => {
      await publishChatRoomMessageRealtime(message, "update");
      const members = await prisma.chatRoomUserMember.findMany({
        where: { roomId: message.roomId },
        select: { userId: true },
      });
      await publishChatRoomsChanged({
        userIds: members.map((member) => member.userId),
        collections: ["active"],
        roomId: message.roomId,
      });
    }).catch((error) => {
      // The published payload is the message itself: content-free fields only.
      emitCoreError(
        {
          operation: "chat_signal_change_announce",
          messageId: message.id,
          roomId: message.roomId,
        },
        {
          message: "Could not announce a chat signal change",
          why: "Publishing the updated message to the room's members failed",
          fix: "Members see the change on their next refresh. If it repeats, check Ably's status and look up the error name and code under failure.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }),
  );
  return chatRoomMessageSchema.parse(
    mapChatRoomMessage(await withChatRoomReplyCount(prisma, message), userId),
  );
}
