import prisma from "@/lib/db/prisma";

/** How many prior messages the coworker sees as conversation context. */
const ROOM_CONTEXT_MESSAGE_LIMIT = 10;
/** Per-message cap inside the context block so one wall of text cannot eat the prompt. */
const ROOM_CONTEXT_MESSAGE_MAX_CHARS = 500;

export interface RoomContextMessage {
  senderName: string;
  isCoworker: boolean;
  isSokoBot?: boolean;
  content: string;
}

function formatContextLine(message: RoomContextMessage): string {
  const flattened = message.content.replace(/\s+/g, " ").trim();
  const truncated =
    flattened.length > ROOM_CONTEXT_MESSAGE_MAX_CHARS
      ? `${flattened.slice(0, ROOM_CONTEXT_MESSAGE_MAX_CHARS)}…`
      : flattened;
  const senderLabel = message.isSokoBot
    ? `${message.senderName} (personal assistant)`
    : message.isCoworker
      ? `${message.senderName} (AI coworker)`
      : message.senderName;
  return `- ${senderLabel}: ${truncated}`;
}

/**
 * Prompt sent to a coworker for a room mention or thread reply. The
 * CONTEXT block carries the recent messages the coworker never saw (it only
 * receives what is addressed to it), oldest first. Nothing in it is secret —
 * it is the same room history the humans in the room can read.
 */
export function buildRoomMentionPrompt(params: {
  roomName: string;
  senderName: string;
  content: string;
  isThreadReply: boolean;
  contextMessages: readonly RoomContextMessage[];
}): string {
  const action = params.isThreadReply
    ? "replied to a thread you are part of"
    : "mentioned you";
  const messageBlock = `${params.senderName} ${action} in #${params.roomName}:\n\n${params.content}`;

  if (params.contextMessages.length === 0) {
    return messageBlock;
  }

  const contextLines = params.contextMessages.map(formatContextLine);
  return `CONTEXT (last ${params.contextMessages.length} messages in #${params.roomName}):\n${contextLines.join("\n")}\n\n${messageBlock}`;
}

export async function loadRoomContextMessages(params: {
  roomId: string;
  messageId: string;
  createdAt: Date;
  threadRootId: string | null;
}): Promise<RoomContextMessage[]> {
  const contextRows = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: params.roomId,
      id: { not: params.messageId },
      deletedAt: null,
      createdAt: { lte: params.createdAt },
      ...(params.threadRootId
        ? {
            OR: [
              { id: params.threadRootId },
              { parentMessageId: params.threadRootId },
            ],
          }
        : // Top-level mentions should not pull thread replies into CONTEXT.
          { parentMessageId: null }),
    },
    orderBy: { createdAt: "desc" },
    take: ROOM_CONTEXT_MESSAGE_LIMIT,
    select: {
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
      senderSokoBot: { select: { name: true } },
    },
  });
  return contextRows.reverse().map((row) => ({
    senderName:
      row.senderSokoBot?.name?.trim() ||
      row.senderCoworker?.name ||
      row.senderUser?.name ||
      "Unknown sender",
    isCoworker: row.senderCoworker != null,
    isSokoBot: row.senderSokoBot != null,
    content: row.content,
  }));
}
