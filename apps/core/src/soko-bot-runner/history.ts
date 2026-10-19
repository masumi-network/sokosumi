import type { ModelMessage } from "ai";

/**
 * About 20k tokens. Past it, old tool results and call inputs are cut down:
 * a background run takes hundreds of steps, and every step pays for the whole
 * history again. At 160k with only results shortened, a six-hour Gmail run
 * averaged 170k input tokens a step.
 */
export const HISTORY_BUDGET_CHARS = 80_000;
/** The newest messages stay whole: the model is usually working on them. */
const RECENT_MESSAGES = 6;
/**
 * The boundary moves in blocks, so the shortened prefix stays byte-identical
 * for several steps and the provider's prompt cache keeps hitting.
 */
const BOUNDARY_BLOCK = 8;
const KEPT_CHARS = 400;
const SHORTENED_NOTE =
  " … [shortened to save room; call the tool again if you need it]";

function shorten(value: unknown): string | null {
  const text = JSON.stringify(value) ?? "";
  return text.length > KEPT_CHARS + SHORTENED_NOTE.length
    ? text.slice(0, KEPT_CHARS) + SHORTENED_NOTE
    : null;
}

function shortenMessage(message: ModelMessage): ModelMessage {
  if (message.role === "tool")
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const short = shorten(part.output);
        return short
          ? { ...part, output: { type: "text" as const, value: short } }
          : part;
      }),
    };
  if (message.role === "assistant" && Array.isArray(message.content))
    return {
      ...message,
      // Old reasoning is never replayed for its content; a call's input is
      // already done (a batch of table rows can be thousands of characters).
      content: message.content
        .filter((part) => part.type !== "reasoning")
        .map((part) => {
          if (part.type !== "tool-call") return part;
          const short = shorten(part.input);
          return short ? { ...part, input: { shortened: short } } : part;
        }),
    };
  return message;
}

/**
 * The history with old tool results, call inputs and reasoning shortened, or
 * null while it still fits. Calls and results stay paired, so every provider
 * accepts the replay.
 */
export function compactHistory(
  messages: readonly ModelMessage[],
  budgetChars = HISTORY_BUDGET_CHARS,
): ModelMessage[] | null {
  if (JSON.stringify(messages).length <= budgetChars) return null;
  const oldEnd = Math.max(
    0,
    Math.floor((messages.length - RECENT_MESSAGES) / BOUNDARY_BLOCK) *
      BOUNDARY_BLOCK,
  );
  return messages.map((message, index) =>
    index < oldEnd ? shortenMessage(message) : message,
  );
}
