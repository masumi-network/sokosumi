import type { ChatRoomMessage } from "@sokosumi/core-client";

export interface CusoMessage {
  id: string;
  fromCuso: boolean;
  author: string;
  content: string;
  createdAt: string;
}

/**
 * A mention by id ("@<uuid>", "@<uuid>:slug" or a 32-character user id),
 * as Sokosumi stores it.
 */
const ID_MENTION =
  /@(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9]{32}(?![A-Za-z0-9]))(?::\S+)?\s?/gi;

/**
 * The text without id mentions. Cuso's room is the owner's, so a mention
 * only says who he means, and CMO once showed it as a raw id.
 */
export function withoutIdMentions(content: string): string {
  return content.replace(ID_MENTION, "").trim();
}

/** A background run that found nothing more to say. */
const NOTHING_TO_ADD = /^nothing to add\.?$/i;

/**
 * What Cuso meant to say. A background run can post its raw answer (the
 * JSON with a `message`) or its "DONE:" marker, which the owner never needs.
 */
export function cusoText(content: string): string {
  const text = withoutIdMentions(content);
  if (text.startsWith("{")) {
    try {
      const answer: unknown = JSON.parse(text);
      if (
        answer &&
        typeof answer === "object" &&
        "message" in answer &&
        typeof answer.message === "string"
      ) {
        return answer.message.trim();
      }
    } catch {
      // Not an answer object; show it as written.
    }
  }
  return text.replace(/^DONE:\s*/, "");
}

/** Chat messages as CMO shows them: top level, not deleted, oldest first. */
export function toCusoMessages(messages: ChatRoomMessage[]): CusoMessage[] {
  return messages
    .filter(
      (message) =>
        message.parentMessageId === null && message.deletedAt === null,
    )
    .map((message) => {
      const fromCuso = message.sender.type === "sokoBot";
      return {
        id: message.id,
        fromCuso,
        author:
          message.sender.type === "sokoBot"
            ? message.sender.sokoBot.name
            : message.sender.type === "user"
              ? message.sender.user.name
              : "Sokosumi",
        content: fromCuso
          ? cusoText(message.content)
          : withoutIdMentions(message.content),
        createdAt: new Date(message.createdAt).toISOString(),
      };
    })
    .filter(
      (message) =>
        message.content.length > 0 &&
        !(message.fromCuso && NOTHING_TO_ADD.test(message.content)),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
