/**
 * Part `type` values that must never be classified as reasoning. Shared by
 * Core (Zod + `message-content` normalization) and the web conversation API
 * mapper so ingress, persistence, and UI rehydration cannot drift.
 */
export const CHAT_UI_NON_REASONING_PART_TYPE_VALUES = [
  "text",
  "file",
  "input_text",
  "output_text",
] as const satisfies readonly string[];

export const CHAT_UI_NON_REASONING_PART_TYPES = new Set<string>(
  CHAT_UI_NON_REASONING_PART_TYPE_VALUES,
);

/**
 * True when a structured segment `type` should be treated as model reasoning
 * (including provider-specific labels like `redacted_reasoning`), as opposed
 * to user-visible body types (`text`, `output_text`, `file`, …).
 */
export function isChatUiProviderReasoningPartType(type: unknown): boolean {
  if (typeof type !== "string") {
    return false;
  }
  const raw = type.trim();
  if (raw.length === 0) {
    return false;
  }
  return !CHAT_UI_NON_REASONING_PART_TYPES.has(raw);
}
