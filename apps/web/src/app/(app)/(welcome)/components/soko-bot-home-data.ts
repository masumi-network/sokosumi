import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

/** One of the user's own requests in the bot's Direct, newest first. */
export interface SokoBotHomeChat {
  messageId: string;
  title: string;
  createdAt: Date;
}

/** Room page the home reads; one page holds plenty of recent requests. */
export const SOKO_BOT_HOME_MESSAGE_PAGE = 50;
export const SOKO_BOT_HOME_RECENT_LIMIT = 8;

/**
 * The user's 1:1 with this bot: a Direct whose only agent is the bot, the
 * same room `ensureSokoBotDirectRoomAction` creates or returns.
 */
export function findSokoBotDirectRoom(
  rooms: readonly ChatRoom[],
  sokoBotId: string,
): ChatRoom | null {
  return (
    rooms.find(
      (room) =>
        room.kind === "direct" &&
        room.coworkerMembers.length === 0 &&
        room.userMembers.length <= 1 &&
        room.sokoBotMembers.length === 1 &&
        room.sokoBotMembers[0]?.id === sokoBotId,
    ) ?? null
  );
}

/** First non-empty line as plain text, or null when nothing readable is left. */
export function chatTitle(content: string): string | null {
  const line = content
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  const plain = stripInlineMarkdown(line).replace(/^>\s*/, "").trim();
  return plain.length > 0 ? plain : null;
}

/** The user's own top-level messages, newest first, as titled rows. */
export function toRecentChats(
  messages: readonly ChatRoomMessage[],
  userId: string,
  limit = SOKO_BOT_HOME_RECENT_LIMIT,
): SokoBotHomeChat[] {
  const chats: SokoBotHomeChat[] = [];
  for (const message of [...messages].reverse()) {
    if (chats.length >= limit) break;
    if (message.deletedAt || message.parentMessageId) continue;
    if (message.sender.type !== "user" || message.sender.user.id !== userId) {
      continue;
    }
    const title = chatTitle(message.content);
    if (!title) continue;
    chats.push({
      messageId: message.id,
      title,
      createdAt: message.createdAt,
    });
  }
  return chats;
}
