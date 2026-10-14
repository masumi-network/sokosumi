import type { ModelMessage } from "ai";

/**
 * About 40k tokens. Past it, old tool results are cut down so an hour-long
 * turn fits a cheaper model's window and does not pay for every page of mail
 * it read again on each step.
 */
export const HISTORY_BUDGET_CHARS = 160_000;
/** The newest messages stay whole: the model is usually working on them. */
const RECENT_MESSAGES = 10;
const KEPT_RESULT_CHARS = 400;
const SHORTENED_NOTE =
  " … [shortened to save room; call the tool again if you need it]";

function shorten(output: unknown): string | null {
  const text = JSON.stringify(output) ?? "";
  return text.length > KEPT_RESULT_CHARS + SHORTENED_NOTE.length
    ? text.slice(0, KEPT_RESULT_CHARS) + SHORTENED_NOTE
    : null;
}

/**
 * The history with old tool results shortened, or null while it still fits.
 * Calls and results stay paired, so every provider accepts the replay.
 */
export function compactHistory(
  messages: readonly ModelMessage[],
  budgetChars = HISTORY_BUDGET_CHARS,
): ModelMessage[] | null {
  if (JSON.stringify(messages).length <= budgetChars) return null;
  const oldEnd = Math.max(0, messages.length - RECENT_MESSAGES);
  return messages.map((message, index) => {
    if (index >= oldEnd || message.role !== "tool") return message;
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
  });
}
