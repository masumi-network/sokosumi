import type { ChatRoomMessage } from "@sokosumi/core-client";

export interface CusoMessage {
  id: string;
  fromCuso: boolean;
  author: string;
  content: string;
  createdAt: string;
}

/** A mention by id ("@<uuid>" or "@<uuid>:slug"), as Sokosumi stores it. */
const ID_MENTION =
  /@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::\S+)?\s?/gi;

/**
 * The text without id mentions. Cuso's room is the owner's, so a mention
 * only says who he means, and CMO once showed it as a raw id.
 */
export function withoutIdMentions(content: string): string {
  return content.replace(ID_MENTION, "").trim();
}

/** Chat messages as CMO shows them: top level, not deleted, oldest first. */
export function toCusoMessages(messages: ChatRoomMessage[]): CusoMessage[] {
  return messages
    .filter(
      (message) =>
        message.parentMessageId === null &&
        message.deletedAt === null &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      id: message.id,
      fromCuso: message.sender.type === "sokoBot",
      author:
        message.sender.type === "sokoBot"
          ? message.sender.sokoBot.name
          : message.sender.type === "user"
            ? message.sender.user.name
            : "Sokosumi",
      content: withoutIdMentions(message.content),
      createdAt: new Date(message.createdAt).toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
