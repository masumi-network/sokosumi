import type { ChatRoomMessage } from "@sokosumi/core-client";
import { type CmoCompetitorWeek, readCmoCompetitorWeek } from "@sokosumi/utils";
import { type CusoTrace, traceOf } from "./trace";

export interface CusoMessage {
  id: string;
  fromCuso: boolean;
  author: string;
  content: string;
  createdAt: string;
  /** How Cuso got to this reply, when Core kept it. */
  trace?: CusoTrace | null;
  /** The turn that wrote it, when Core says: a background run's report. */
  turnId?: string | null;
  /** The week's competitor moves, when this is Core's message about them. */
  week?: CmoCompetitorWeek | null;
}

/** The turn a bot's message came from, as Core records it on the message. */
function turnOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const bot = (metadata as { soko_bot?: unknown }).soko_bot;
  if (!bot || typeof bot !== "object") return null;
  const turnId = (bot as { turn_id?: unknown }).turn_id;
  return typeof turnId === "string" ? turnId : null;
}

function budgetFailureOf(metadata: ChatRoomMessage["metadata"]) {
  if (metadata?.mention_failed !== true) return null;
  const failure = metadata.mention_failure;
  if (
    !failure ||
    typeof failure !== "object" ||
    !("kind" in failure) ||
    failure.kind !== "ai_budget_exceeded" ||
    !("message" in failure) ||
    typeof failure.message !== "string"
  )
    return null;
  return failure.message;
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
              : message.sender.type === "coworker"
                ? message.sender.coworker.name
                : "Team",
        content: fromCuso
          ? (budgetFailureOf(message.metadata) ?? cusoText(message.content))
          : withoutIdMentions(message.content),
        createdAt: new Date(message.createdAt).toISOString(),
        trace: fromCuso ? traceOf(message.metadata) : null,
        turnId: fromCuso ? turnOf(message.metadata) : null,
        week: fromCuso ? readCmoCompetitorWeek(message.metadata) : null,
      };
    })
    .filter(
      (message) =>
        message.content.length > 0 &&
        !(message.fromCuso && NOTHING_TO_ADD.test(message.content)),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
