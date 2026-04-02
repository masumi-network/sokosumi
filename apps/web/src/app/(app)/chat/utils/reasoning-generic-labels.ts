const REASONING_GENERIC_LABELS = new Set([
  "Processing...",
  "Thinking...",
  "Searching files...",
  "Calling tools...",
]);

export function isReasoningGenericLabel(message: string): boolean {
  return REASONING_GENERIC_LABELS.has(message) || message.trim() === "";
}
