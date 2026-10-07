import { chatRoomFileLinks } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import { readQuoteFromMetadata } from "@/routes/v1/chats/rooms/helpers";

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
 * What a message says to an AI reader: the quoted message, when there is one,
 * above the sender's own words. A quote can be the whole message.
 */
export function roomMessagePromptText(
  content: string,
  quote: { authorName: string; snippet: string } | null,
): string {
  if (!quote) {
    return content;
  }
  const quoted = `> ${quote.authorName}: ${quote.snippet.replace(/\s+/g, " ").trim()}`;
  return content.trim().length === 0 ? quoted : `${quoted}\n\n${content}`;
}

/**
 * Names the files attached to a message, so a Soko Bot knows it can save
 * them to Files (upload_file with attachmentUrl) instead of asking the owner
 * to upload what they already sent.
 */
export function withAttachmentNote(prompt: string, content: string): string {
  const files = chatRoomFileLinks(content);
  if (files.length === 0) return prompt;
  const lines = files.map((file) => `- ${file.name}: ${file.url}`);
  return `${prompt}\n\nAttached to this message (save one to Files with upload_file and its link as attachmentUrl):\n${lines.join("\n")}`;
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
      metadata: true,
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
    content: roomMessagePromptText(
      row.content,
      readQuoteFromMetadata(row.metadata),
    ),
  }));
}
