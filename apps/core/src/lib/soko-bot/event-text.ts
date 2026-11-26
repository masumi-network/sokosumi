import { redactSokoBotSensitiveText } from "@sokosumi/soko-bot";

const EVENT_TEXT_LIMIT = 800;
const REASONING_TEXT_LIMIT = 4_000;

/** Model-authored text, bounded and secret-scrubbed, for the owner's explain view. */
export function safeEventText(
  value: unknown,
  limit = EVENT_TEXT_LIMIT,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replaceAll("\u0000", "").trim();
  if (!trimmed) return null;
  const scrubbed = redactSokoBotSensitiveText(trimmed);
  // A cut inside an emoji leaves half of it; Postgres refused that and the
  // turn never settled ("invalid input syntax for type json").
  return (
    scrubbed.length > limit ? `${scrubbed.slice(0, limit - 1)}…` : scrubbed
  ).toWellFormed();
}

/**
 * A sentence about how Core wants the answer written rather than about the
 * owner's work: the JSON reply, its fields, receipts, the claim check, the
 * DONE marker. The model's summary repeats these ("The final response should
 * be a JSON object, and I shouldn't mention the actions taken"), and the
 * owner read them as the bot's Thought.
 */
const ANSWER_CONTRACT = [
  // The reply's shape: "The final response should be a JSON object",
  // "My reply should use the required response schema".
  /\b(final|my|the) (response|reply|answer|output)\b[^.!?\n]*\b(JSON|schema|observationToolCallIds|kind)\b/i,
  /\bJSON (object|reply|response)\b|\bresponse schema\b/i,
  /observationToolCallIds|evidenceToolCallId|toolCallId|claim[- ]check|verified actions?|Core lists/i,
  // Core's receipts, not an expense report's.
  /\b(Core|Core's|verified|action)\b[^.!?\n]*\breceipts?\b|\breceipts?\b[^.!?\n]*\b(Core|above|confirm(s|ed)?|list(s|ed)?)\b/i,
  /\b(should ?n[o']t|must ?n[o']t|can ?n[o']t|cannot|not to|never|avoid)\b[^.!?\n]*\b(mention|claim|stat(e|ing)|nam(e|ing))\b[^.!?\n]*\b(action|change|created|sent|scheduled|assigned|posted|did|done|ids?)\b/i,
];

/** The reply's kinds and the background marker, in Core's capitals only. */
const ANSWER_KINDS = /\b(REPORT|CLARIFY|SILENT)\b|\bDONE:/;

/** The summary without sentences about the answer's format; sections left empty go too. */
export function withoutAnswerContract(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .filter(
          (sentence) =>
            !ANSWER_CONTRACT.some((rule) => rule.test(sentence)) &&
            !ANSWER_KINDS.test(sentence),
        )
        .join(" ")
        .trim(),
    )
    .filter(Boolean)
    .filter(
      (paragraph, index, all) =>
        !/^\*\*[^*]+\*\*$/.test(paragraph) ||
        (all[index + 1] !== undefined &&
          !/^\*\*[^*]+\*\*$/.test(all[index + 1]!)),
    )
    .join("\n\n");
}

/**
 * A provider reasoning summary as it may be shown: secret-scrubbed, bounded
 * and without Core's instructions for the answer. Null when nothing is left.
 */
export function safeReasoningSummary(data: unknown): string | null {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const text = record.text ?? record.reasoning ?? record.message;
  return safeEventText(
    typeof text === "string" ? withoutAnswerContract(text) : text,
    REASONING_TEXT_LIMIT,
  );
}
