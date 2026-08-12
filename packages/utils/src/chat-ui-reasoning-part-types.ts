/**
 * Allowlisted part `type` values for Thought collection (live stream, durable
 * disclosure, Core persist/Zod). Matches AI SDK `ReasoningUIPart` (`type:
 * "reasoning"`) and `@sokosumi/ai-provider` stream materialization.
 *
 * Prefer this over invert-style classification so tool/step parts with a
 * `text`/`content` field never surface as Thought.
 */
export const CHAT_UI_REASONING_PART_TYPE_VALUES = [
  "reasoning",
] as const satisfies readonly string[];

export const CHAT_UI_REASONING_PART_TYPES = new Set<string>(
  CHAT_UI_REASONING_PART_TYPE_VALUES,
);

/**
 * True when a structured segment `type` is the allowlisted model-reasoning
 * label (`reasoning`). Use for Thought collection only; answer body extraction
 * should allowlist text-like types, not invert this set.
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
