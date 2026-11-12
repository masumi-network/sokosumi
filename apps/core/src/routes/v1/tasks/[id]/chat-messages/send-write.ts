import type { Prisma } from "@sokosumi/database";

import { conflict } from "@/helpers/error";
import { chatRoomMessageInclude } from "@/routes/v1/chats/rooms/helpers";

/** Where a sent Task's attempt is kept on its message. */
const TASK_CHAT_ATTEMPT_KEY = "task_chat_attempt";

/**
 * Write a Task send into a room, after `lockTaskChatSend` and the checks. A
 * retry of the same attempt answers with the first message instead. The room
 * is already locked for update, so this write cannot deadlock with another
 * send into the room.
 */
export async function writeTaskChatMessage(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string;
    userId: string;
    clientMessageId: string;
    content: string;
    attempt: { taskId: string; note: string };
  },
) {
  const { roomId, userId, clientMessageId, content, attempt } = input;
  const existing = await tx.chatRoomMessage.findUnique({
    where: { roomId_clientMessageId: { roomId, clientMessageId } },
    include: chatRoomMessageInclude,
  });
  if (existing) {
    return {
      message: assertSameAttempt(existing, userId, attempt),
      didCreate: false,
    };
  }

  // No mention rows, so nothing is dispatched to a Coworker or Soko Bot.
  const message = await tx.chatRoomMessage.create({
    data: {
      roomId,
      senderUserId: userId,
      content,
      clientMessageId,
      metadata: {
        client_message_id: clientMessageId,
        [TASK_CHAT_ATTEMPT_KEY]: attempt,
      },
    },
    include: chatRoomMessageInclude,
  });
  await tx.chatRoom.update({
    where: { id: roomId },
    data: { updatedAt: new Date() },
  });
  await tx.chatRoomReadState.upsert({
    where: { roomId_userId: { roomId, userId } },
    update: { lastReadAt: message.createdAt },
    create: { roomId, userId, lastReadAt: message.createdAt },
  });
  return { message, didCreate: true };
}

/**
 * A retry is the same attempt when the same person sent the same Task with
 * the same note into the room (the room is part of the id's key). It is
 * compared on what was sent, not on the rendered message, so a Task renamed
 * or a message edited since still answers with the first message. Anything
 * else under the id is a different message and is refused.
 */
export function assertSameAttempt<
  T extends { senderUserId: string | null; metadata: unknown },
>(message: T, userId: string, attempt: { taskId: string; note: string }): T {
  const stored =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)[TASK_CHAT_ATTEMPT_KEY]
      : undefined;
  const same =
    message.senderUserId === userId &&
    stored !== null &&
    typeof stored === "object" &&
    (stored as { taskId?: unknown }).taskId === attempt.taskId &&
    (stored as { note?: unknown }).note === attempt.note;
  if (!same) {
    throw conflict("clientMessageId already used for another message");
  }
  return message;
}
