import { waitUntil } from "@vercel/functions";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
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
    (async () => {
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
    })().catch((error) => {
      console.error("Failed to announce a chat signal change", error);
    }),
  );
  return chatRoomMessageSchema.parse(mapChatRoomMessage(message, userId));
}
