/**
 * Part `type` values that must never be classified as reasoning. Shared by
 * Zod (`chatUiReasoningPartSchema`) and runtime normalization
 * (`normalizeReasoningPart` in `message-content.ts`) so ingress and
 * persistence cannot drift.
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
