/**
 * Body part `type` values that are never reasoning. Retained for callers that
 * need the body denylist; Thought **collection** uses the allowlist below.
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
 * Allowlisted part `type` values for Thought collection (live stream, durable
 * disclosure, Core persist/Zod). Prefer this over invert-style classification so
 * tool/step parts with a `text`/`content` field never surface as Thought.
 *
 * Extend only when a provider label is intentionally supported as Thought.
 */
export const CHAT_UI_REASONING_PART_TYPE_VALUES = [
  "reasoning",
  "redacted_reasoning",
] as const satisfies readonly string[];

export const CHAT_UI_REASONING_PART_TYPES = new Set<string>(
  CHAT_UI_REASONING_PART_TYPE_VALUES,
);

/**
 * True when a structured segment `type` is an allowlisted model-reasoning label
 * (e.g. `reasoning`, `redacted_reasoning`). Use for Thought collection only;
 * answer body extraction should allowlist text-like types, not invert this set.
 */
export function isChatUiProviderReasoningPartType(type: unknown): boolean {
  if (typeof type !== "string") {
    return false;
  }
  const raw = type.trim();
  if (raw.length === 0) {
    return false;
  }
  return CHAT_UI_REASONING_PART_TYPES.has(raw);
}
