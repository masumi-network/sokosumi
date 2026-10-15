import type { ChatRoomMessage } from "@sokosumi/core-client";

export interface CusoMessage {
  id: string;
  fromCuso: boolean;
  author: string;
  content: string;
  createdAt: string;
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
      content: message.content,
      createdAt: new Date(message.createdAt).toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
