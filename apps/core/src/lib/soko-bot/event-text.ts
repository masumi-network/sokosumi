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
 * A provider reasoning summary as it may be shown: secret-scrubbed and
 * bounded. Null when the runtime event carries no text.
 */
export function safeReasoningSummary(data: unknown): string | null {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return safeEventText(
    record.text ?? record.reasoning ?? record.message,
    REASONING_TEXT_LIMIT,
  );
}
